import { Engine, Scene, Component, Transform, Vec2, defineBlueprint } from "@yage/core";
import {
  RendererPlugin,
  CameraKey,
  RenderLayerManagerKey,
} from "@yage/renderer";
import type { Camera } from "@yage/renderer";
import { Assets } from "pixi.js";
import { TilemapPlugin, TilemapComponent, tiledMap } from "@yage/tilemap";
import { DebugPlugin } from "@yage/debug";
import { DebugRegistryKey } from "@yage/debug/api";
import type { DebugContributor, WorldDebugApi } from "@yage/debug/api";
import type { RectColliderConfig } from "@yage/tilemap";
import { injectStyles, keys, getContainer } from "./shared.js";

injectStyles();

// ---------------------------------------------------------------------------
// Asset handles
// ---------------------------------------------------------------------------
const DungeonMap = tiledMap("/assets/dungeon/dungeon-map.json");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WIDTH = 800;
const HEIGHT = 600;
const PAN_SPEED = 0.35; // px per ms

// ---------------------------------------------------------------------------
// CameraPan — WASD panning + scroll zoom
// ---------------------------------------------------------------------------
class CameraPan extends Component {
  private camera!: Camera;
  private wheelHandler!: (e: WheelEvent) => void;

  onAdd(): void {
    this.camera = this.use(CameraKey);

    // Listen for mouse wheel zoom
    const container = getContainer();
    this.wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      const dir = e.deltaY > 0 ? -1 : 1;
      const next = Math.min(Math.max(this.camera.zoom + dir * 0.25, 0.5), 4);
      this.camera.zoomTo(next, 150);
    };
    container.addEventListener("wheel", this.wheelHandler, { passive: false });
  }

  onDestroy(): void {
    getContainer().removeEventListener("wheel", this.wheelHandler);
  }

  update(dt: number): void {
    let dx = 0;
    let dy = 0;
    if (keys.has("w") || keys.has("arrowup")) dy -= 1;
    if (keys.has("s") || keys.has("arrowdown")) dy += 1;
    if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
    if (keys.has("d") || keys.has("arrowright")) dx += 1;

    if (dx !== 0 || dy !== 0) {
      const move = new Vec2(dx, dy).normalize().scale(PAN_SPEED * dt);
      this.camera.position = this.camera.position.add(move);
    }
  }
}

// ---------------------------------------------------------------------------
// WallDebugContributor — draws tilemap wall collision shapes via debug overlay
// ---------------------------------------------------------------------------
class WallDebugContributor implements DebugContributor {
  readonly name = "walls";
  readonly flags = ["shapes"] as const;

  constructor(private readonly shapes: readonly RectColliderConfig[]) {}

  drawWorld(api: WorldDebugApi): void {
    if (!api.isFlagEnabled("shapes")) return;

    for (const shape of this.shapes) {
      const g = api.acquireGraphics();
      if (!g) return;
      g.rect(shape.x, shape.y, shape.width, shape.height)
        .fill({ color: 0xff0000, alpha: 0.15 })
        .stroke({ width: 1 / api.cameraZoom, color: 0xff0000, alpha: 0.5 });
    }
  }
}

// ---------------------------------------------------------------------------
// Blueprints
// ---------------------------------------------------------------------------
import type { TiledMapData } from "@yage/tilemap";

const DungeonMapBP = defineBlueprint<{ map: TiledMapData }>(
  "dungeon-map",
  (entity, { map }) => {
    entity.add(new Transform());
    entity.add(new TilemapComponent({ map, layer: "map" }));
  },
);

const CameraCtrlBP = defineBlueprint("camera-ctrl", (entity) => {
  entity.add(new Transform());
  entity.add(new CameraPan());
});

// ---------------------------------------------------------------------------
// TilemapScene
// ---------------------------------------------------------------------------
class TilemapScene extends Scene {
  readonly name = "tilemap";
  readonly preload = [DungeonMap];
  private readonly layerMgr = this.service(RenderLayerManagerKey);
  private readonly camera = this.service(CameraKey);

  onEnter(): void {
    this.layerMgr.create("map", -10);

    // -- Tilemap entity --
    const mapData = this.assets.get(DungeonMap);
    const mapEntity = this.spawn(DungeonMapBP, { map: mapData });
    const tilemap = mapEntity.get(TilemapComponent);

    const mapW = tilemap.widthPx;
    const mapH = tilemap.heightPx;

    // -- Find player spawn point --
    const players = tilemap.getObjects("interactables")["Player"];
    const spawn = players?.[0];
    const startX = spawn?.x ?? mapW / 2;
    const startY = spawn?.y ?? mapH / 2;

    // -- Camera setup --
    this.camera.position = new Vec2(startX, startY);
    this.camera.bounds = { minX: 0, minY: 0, maxX: mapW, maxY: mapH };

    // -- Register wall collision shapes as a debug contributor --
    const shapes = tilemap.getCollisionShapes("walls");
    const rectShapes = shapes.filter(
      (s): s is RectColliderConfig => s.type === "rect",
    );
    const registry = this.context.tryResolve(DebugRegistryKey);
    registry?.register(new WallDebugContributor(rectShapes));

    // -- Camera controller --
    this.spawn(CameraCtrlBP);
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
      container: getContainer(),
    }),
  );
  engine.use(new TilemapPlugin());
  engine.use(new DebugPlugin({ startEnabled: true }));

  await engine.start();

  // Load the spritesheet atlas first so tile textures are in PixiJS cache
  // before the tiledMap loader resolves tile GIDs.
  await Assets.load("/assets/dungeon/dungeon.json");

  await engine.scenes.push(new TilemapScene());
}

main().catch(console.error);
