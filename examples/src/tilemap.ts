/**
 * Tilemap demo — also doubles as the manual-test fixture for
 * `LayerDef.isRenderGroup`.
 *
 * Layout (top → bottom in draw order):
 *
 *   canopy   (Tiled "Details", isRenderGroup: true)
 *   actors   (player + enemies, isRenderGroup: true, hosts the bloom filter)
 *   map      (Tiled "background" + "foreground")
 *
 * Press `F` to toggle a bloom filter on the player. With `isRenderGroup`
 * set on both `actors` and `canopy`, the canopy stays put when the filter
 * fires; flip either to `false` and the canopy will drift because
 * `@pixi/tilemap`'s pipe reads `globalUniforms._activeUniforms.at(-1)`
 * and picks up the polluted `uWorldTransformMatrix` left by the filter.
 */
import { Engine, Scene, Entity, Component, Transform, Vec2 } from "@yagejs/core";
import {
  RendererPlugin,
  CameraEntity,
  GraphicsComponent,
  renderAsset,
  type LayerDef,
} from "@yagejs/renderer";
import type { EffectHandle } from "@yagejs/renderer";
import { bloom } from "@yagejs/effects";
import {
  TilemapPlugin,
  TilemapComponent,
  tiledMap,
  type MapObject,
  type RectColliderConfig,
} from "@yagejs/tilemap";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import { DebugRegistryKey } from "@yagejs/debug/api";
import type {
  DebugContributor,
  HudDebugApi,
  WorldDebugApi,
} from "@yagejs/debug/api";
import { injectStyles, setupGameContainer } from "./shared.js";

injectStyles();

// ---------------------------------------------------------------------------
// Asset handles
// ---------------------------------------------------------------------------
const DungeonAtlas = renderAsset("/assets/dungeon/dungeon.json");
const DungeonMap = tiledMap("/assets/dungeon/dungeon-map.json");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WIDTH = 800;
const HEIGHT = 600;
const PLAYER_SPEED = 0.18; // px per ms
const PLAYER_RADIUS = 6;
const ENEMY_RADIUS = 5;
const CAMERA_ZOOM = 1.75;

const ENEMY_COLORS: Record<string, number> = {
  Base: 0xe88555,
  Bat: 0xc94f7c,
};

// ---------------------------------------------------------------------------
// Player — WASD movement with axis-separated wall collision
// ---------------------------------------------------------------------------
class Player extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly walls: readonly RectColliderConfig[];
  private readonly camera: CameraEntity;
  private bloomHandle: EffectHandle | null = null;

  constructor(walls: readonly RectColliderConfig[], camera: CameraEntity) {
    super();
    this.walls = walls;
    this.camera = camera;
  }

  update(dt: number): void {
    if (this.input.isJustPressed("toggleFilter")) {
      const g = this.entity.get(GraphicsComponent);
      if (this.bloomHandle) {
        this.bloomHandle.remove();
        this.bloomHandle = null;
      } else {
        this.bloomHandle = g.fx.addEffect(
          bloom({ bloomScale: 2.5, blur: 12, quality: 6 }),
        );
      }
    }

    const dir = this.input.getVector("left", "right", "up", "down");
    if (dir.x === 0 && dir.y === 0) {
      this.camera.position = this.entity.get(Transform).position;
      return;
    }

    const move = dir.normalize().scale(PLAYER_SPEED * dt);
    const t = this.entity.get(Transform);

    // Axis-separated sweep: try X then Y, blocking each independently so
    // the player can slide along walls instead of snagging on corners.
    const nextX = t.position.x + move.x;
    if (!this._hits(nextX, t.position.y)) {
      t.setPosition(nextX, t.position.y);
    }
    const nextY = t.position.y + move.y;
    if (!this._hits(t.position.x, nextY)) {
      t.setPosition(t.position.x, nextY);
    }

    this.camera.position = t.position;
  }

  private _hits(x: number, y: number): boolean {
    for (const w of this.walls) {
      if (
        x + PLAYER_RADIUS > w.x &&
        x - PLAYER_RADIUS < w.x + w.width &&
        y + PLAYER_RADIUS > w.y &&
        y - PLAYER_RADIUS < w.y + w.height
      ) {
        return true;
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
class PlayerEntity extends Entity {
  setup(params: {
    object: MapObject;
    walls: readonly RectColliderConfig[];
    camera: CameraEntity;
  }): void {
    this.add(new Transform({ position: new Vec2(params.object.x, params.object.y) }));
    this.add(
      new GraphicsComponent({ layer: "actors" }).draw((g) =>
        g.circle(0, 0, PLAYER_RADIUS).fill({ color: 0x6dc1f5 }).stroke({
          width: 1,
          color: 0xffffff,
        }),
      ),
    );
    this.add(new Player(params.walls, params.camera));
  }
}

class EnemyEntity extends Entity {
  setup(params: { object: MapObject; type: string }): void {
    this.add(new Transform({ position: new Vec2(params.object.x, params.object.y) }));
    const color = ENEMY_COLORS[params.type] ?? 0x999999;
    this.add(
      new GraphicsComponent({ layer: "actors" }).draw((g) =>
        g.circle(0, 0, ENEMY_RADIUS).fill({ color }).stroke({
          width: 1,
          color: 0x000000,
          alpha: 0.6,
        }),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Debug contributor — walls + spawn-controller wiring + entity keys
// ---------------------------------------------------------------------------
class TilemapInspector implements DebugContributor {
  readonly name = "tilemap";
  readonly flags = ["walls", "wiring", "spawnPoints"] as const;

  constructor(
    private readonly walls: readonly RectColliderConfig[],
    private readonly tilemap: TilemapComponent,
  ) {}

  drawWorld(api: WorldDebugApi): void {
    if (api.isFlagEnabled("walls")) {
      for (const w of this.walls) {
        const g = api.acquireGraphics();
        if (!g) return;
        g.rect(w.x, w.y, w.width, w.height)
          .fill({ color: 0xff0000, alpha: 0.12 })
          .stroke({ width: 1 / api.cameraZoom, color: 0xff0000, alpha: 0.45 });
      }
    }

    if (api.isFlagEnabled("spawnPoints")) {
      // Mark every Tiled point object with a hollow ring so the authored
      // spawn locations are visible in-game.
      for (const obj of this.tilemap.getAllObjects()) {
        if (!obj.point) continue;
        const g = api.acquireGraphics();
        if (!g) return;
        g.circle(obj.x, obj.y, 8).stroke({
          width: 1 / api.cameraZoom,
          color: 0x6dc1f5,
          alpha: 0.8,
        });
      }
    }

    if (api.isFlagEnabled("wiring")) {
      // Demonstrate `resolveRefArray`: walk every EnemySpawnController and
      // draw a line to each `spawns[i]` object it references.
      for (const ctrl of this.tilemap.getAllObjects()) {
        if (ctrl.class !== "EnemySpawnController") continue;
        const spawns = this.tilemap.resolveRefArray(ctrl, "spawns");
        for (const s of spawns) {
          const g = api.acquireGraphics();
          if (!g) return;
          g.moveTo(ctrl.x, ctrl.y)
            .lineTo(s.x, s.y)
            .stroke({ width: 1 / api.cameraZoom, color: 0xffd166, alpha: 0.7 });
        }
      }
    }
  }

  drawHud(api: HudDebugApi): void {
    const player = this.tilemap.findObjectByName("Player");
    if (player) api.addLine(`player key: ${this.tilemap.objectKey(player)}`);

    const enemies = this.tilemap
      .getAllObjects()
      .filter((o) => o.class === "EnemySpawn").length;
    api.addLine(`enemies (auto-keyed): ${enemies}`);
  }
}

class TilemapEntity extends Entity {
  setup(): void {
    this.add(new Transform());
    // Base map — everything that should sit BELOW the actors.
    this.add(
      new TilemapComponent({
        source: DungeonMap,
        layer: "map",
        layers: ["background", "foreground"],
      }),
    );
  }
}

/**
 * Canopy entity — the same Tiled map asset, but renders ONLY the "Details"
 * tile layer onto the `"canopy"` YAGE layer above the actors. Hosts a
 * separate TilemapComponent so the canopy gets its own `@pixi/tilemap`
 * pipe pass, which is what makes the `isRenderGroup` isolation observable
 * (canopy reads `uWorldTransformMatrix` at draw time, so without
 * isolation the bloom-filter pass on the actors layer leaks its transform
 * onto the canopy's read and drifts the tiles).
 */
class CanopyEntity extends Entity {
  setup(): void {
    this.add(new Transform());
    this.add(
      new TilemapComponent({
        source: DungeonMap,
        layer: "canopy",
        layers: ["Details"],
        // Disambiguate the auto-key prefix from the base TilemapEntity
        // above so identity-keyed entities don't collide.
        keyPrefix: "canopy",
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// TilemapScene
// ---------------------------------------------------------------------------
class TilemapScene extends Scene {
  readonly name = "tilemap";
  readonly preload = [DungeonMap];
  readonly layers: readonly LayerDef[] = [
    { name: "map", order: -10 },
    // Filtered content lives here. `isRenderGroup: true` gives the actors
    // their own uniform scope so the bloom on the player doesn't leak
    // `uWorldTransformMatrix` onto the canopy's tilemap pipe.
    { name: "actors", order: 0, isRenderGroup: true },
    // Canopy reads from a tilemap pipe and must stay unaffected by the
    // filter's transform. Pair with the actors group above — both layers
    // sit inside their own render group so the global uniform stack is
    // clean when the canopy draws.
    { name: "canopy", order: 10, isRenderGroup: true },
  ];

  onEnter(): void {
    const mapEntity = this.spawn(TilemapEntity);
    const tilemap = mapEntity.get(TilemapComponent);
    // Canopy paints "Details" above actors on the dedicated canopy layer.
    this.spawn(CanopyEntity);

    const mapW = tilemap.widthPx;
    const mapH = tilemap.heightPx;

    // Walls — kept as a typed snapshot so the player and the debug overlay
    // share one source of truth.
    const walls = tilemap
      .getCollisionShapes("walls")
      .filter((s): s is RectColliderConfig => s.type === "rect");

    // Camera anchored to the player.
    const cam = this.spawn(CameraEntity, {
      position: new Vec2(mapW / 2, mapH / 2),
      zoom: CAMERA_ZOOM,
      bounds: { minX: 0, minY: 0, maxX: mapW, maxY: mapH },
    });

    // Spawn the player at the Tiled "Player" point object, with an auto-key
    // derived from the map asset path + Tiled object id.
    const playerObj = tilemap.findObjectByName("Player");
    if (playerObj) {
      this.spawn(
        PlayerEntity,
        { object: playerObj, walls, camera: cam },
        { key: tilemap.objectKey(playerObj) },
      );
    }

    // Spawn one enemy per EnemySpawn point. The `type` custom property
    // comes back as a comma-separated string in this map; split and pick
    // the first kind for the demo.
    tilemap.forEachObject("interactables", (obj, key) => {
      if (obj.class !== "EnemySpawn") return;
      const typeProp = tilemap.getProperty<string>(obj, "type") ?? "Base";
      const type = typeProp.split(",")[0]!.trim();
      this.spawn(EnemyEntity, { object: obj, type }, { key });
    });

    // Debug overlay — walls + spawn-controller wiring + entity-key labels.
    const registry = this.context.tryResolve(DebugRegistryKey);
    registry?.register(new TilemapInspector(walls, tilemap));
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      virtualWidth: WIDTH,
      virtualHeight: HEIGHT,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(new TilemapPlugin());
  engine.use(
    new InputPlugin({
      actions: {
        up: ["KeyW", "ArrowUp"],
        down: ["KeyS", "ArrowDown"],
        left: ["KeyA", "ArrowLeft"],
        right: ["KeyD", "ArrowRight"],
        toggleFilter: ["KeyF"],
      },
    }),
  );
  engine.use(new DebugPlugin({ startEnabled: true }));

  await engine.start();

  // Load the atlas first so tile textures are ready before the map resolves GIDs.
  await engine.assets.loadAll([DungeonAtlas]);

  await engine.scenes.push(new TilemapScene());
}

main().catch(console.error);
