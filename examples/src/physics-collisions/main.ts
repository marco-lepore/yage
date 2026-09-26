import {
  Engine,
  Scene,
  Entity,
  Component,
  Transform,
  Vec2,
  defineEvent,
} from "@yagejs/core";
import {
  RendererPlugin,
  GraphicsComponent,
  TextComponent,
  type LayerDef,
} from "@yagejs/renderer";
import {
  PhysicsPlugin,
  RigidBodyComponent,
  ColliderComponent,
  CollisionLayers,
} from "@yagejs/physics";
import { AudioPlugin, AudioManagerKey, sound } from "@yagejs/audio";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";

const WIDTH = 800;
const HEIGHT = 600;
const WALL = 16;
const PLAYER_SPEED = 200; // px per second
const START_POS = new Vec2(WIDTH / 2, HEIGHT / 2);
const HUD_LAYER = "hud";
const COIN_POINTS = 10;

// Collision layer setup
const layers = new CollisionLayers();
const LAYER_PLAYER = layers.define("player");
const LAYER_WALL = layers.define("wall");
const LAYER_COIN = layers.define("coin");
const LAYER_DANGER = layers.define("danger");

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
const CoinCollected = defineEvent("coin:collected");
const DangerEntered = defineEvent("danger:entered");

// ---------------------------------------------------------------------------
// Sound asset handles
// ---------------------------------------------------------------------------
const CoinSfx = sound("/assets/coin.wav");
const HurtSfx = sound("/assets/hurt.wav");

// ---------------------------------------------------------------------------
// PlayerController — WASD dynamic movement via velocity
// ---------------------------------------------------------------------------
class PlayerController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly audio = this.service(AudioManagerKey);
  private readonly rb = this.sibling(RigidBodyComponent);
  private readonly transform = this.sibling(Transform);

  onAdd(): void {
    // Danger zones emit on themselves; the event bubbles to the scene.
    this.listenScene(DangerEntered, () => this.respawn());
  }

  update(): void {
    const dir = this.input.getVector("left", "right", "up", "down");
    if (dir.x !== 0 || dir.y !== 0) {
      this.rb.setVelocity(dir.normalize().scale(PLAYER_SPEED));
    } else {
      this.rb.setVelocity(Vec2.ZERO);
    }
  }

  /** Back to the start position. */
  private respawn(): void {
    this.audio.play(HurtSfx, { channel: "sfx" });
    this.rb.setPosition(START_POS.x, START_POS.y);
    this.transform.setPosition(START_POS.x, START_POS.y);
  }
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
class PlayerEntity extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(START_POS.x, START_POS.y) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 16).fill({ color: 0x22c55e });
        g.circle(0, 0, 16).stroke({ color: 0x16a34a, width: 2 });
        // Eyes
        g.circle(-5, -4, 3).fill({ color: 0xffffff });
        g.circle(5, -4, 3).fill({ color: 0xffffff });
        g.circle(-5, -4, 1.5).fill({ color: 0x111111 });
        g.circle(5, -4, 1.5).fill({ color: 0x111111 });
      }),
    );
    this.add(
      new RigidBodyComponent({
        type: "dynamic",
        fixedRotation: true,
        gravityScale: 0,
        linearDamping: 20,
      }),
    );
    this.add(
      new ColliderComponent({
        shape: { type: "circle", radius: 16 },
        sensor: false,
        layers: LAYER_PLAYER,
        mask: LAYER_WALL | LAYER_COIN | LAYER_DANGER,
      }),
    );
    this.add(new PlayerController());
  }
}

class WallEntity extends Entity {
  setup(params: { x: number; y: number; w: number; h: number }): void {
    const { x, y, w, h } = params;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color: 0x555555 });
      }),
    );
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: w, height: h },
        layers: LAYER_WALL,
        mask: LAYER_PLAYER,
      }),
    );
  }
}

class CoinEntity extends Entity {
  setup(params: { x: number; y: number }): void {
    const { x, y } = params;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 10).fill({ color: 0xffe66d });
        g.circle(0, 0, 10).stroke({ color: 0xeab308, width: 2 });
        g.circle(0, 0, 4).fill({ color: 0xeab308, alpha: 0.6 });
      }),
    );
    this.add(new RigidBodyComponent({ type: "static", fixedRotation: true }));
    const collider = new ColliderComponent({
      shape: { type: "circle", radius: 10 },
      sensor: true,
      layers: LAYER_COIN,
      mask: LAYER_PLAYER,
    });
    this.add(collider);

    collider.onTrigger((ev) => {
      if (ev.entered) {
        this.emit(CoinCollected);
        this.destroy();
      }
    });
  }
}

class DangerEntity extends Entity {
  setup(params: { x: number; y: number; w: number; h: number }): void {
    const { x, y, w, h } = params;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color: 0xef4444, alpha: 0.4 });
        g.rect(-w / 2, -h / 2, w, h).stroke({ color: 0xef4444, width: 2 });
        // Hazard stripes
        for (let i = -w / 2; i < w / 2; i += 16) {
          g.moveTo(i, -h / 2)
            .lineTo(i + 8, h / 2)
            .stroke({ color: 0xef4444, width: 1, alpha: 0.3 });
        }
      }),
    );
    this.add(new RigidBodyComponent({ type: "static", fixedRotation: true }));
    const collider = new ColliderComponent({
      shape: { type: "box", width: w, height: h },
      sensor: true,
      layers: LAYER_DANGER,
      mask: LAYER_PLAYER,
    });
    this.add(collider);

    collider.onTrigger((ev) => {
      if (ev.entered) {
        this.emit(DangerEntered);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// HUD — the run's score and the text that shows it
// ---------------------------------------------------------------------------

/**
 * Coins add points; touching a danger zone resets the score to zero. The
 * component lives on the HUD entity, so the score starts fresh every time
 * the scene is entered. Other code reads it with
 * `scene.findByKey<HudEntity>(HUD_KEY)?.score`.
 */
class Score extends Component {
  private readonly audio = this.service(AudioManagerKey);
  private readonly text = this.sibling(TextComponent);
  private _points = 0;

  get points(): number {
    return this._points;
  }

  onAdd(): void {
    this.refresh();
    this.listenScene(CoinCollected, () => {
      this._points += COIN_POINTS;
      this.audio.play(CoinSfx, { channel: "sfx" });
      this.refresh();
    });
    this.listenScene(DangerEntered, () => {
      this._points = 0;
      this.refresh();
    });
  }

  private refresh(): void {
    this.text.setText(`Score: ${this._points}`);
  }
}

/** Spawn key of the HUD entity, for `scene.findByKey`. */
const HUD_KEY = "hud";

/** Score readout in the top-right corner, on the screen-space layer. */
class HudEntity extends Entity {
  /** The run's score, hosted on this entity. */
  score!: Score;

  setup(): void {
    this.add(new Transform({ position: new Vec2(WIDTH - 16, 16) }));
    this.add(
      new TextComponent({
        text: "",
        anchor: { x: 1, y: 0 },
        style: { fontFamily: "monospace", fontSize: 20, fill: 0xffe66d },
        layer: HUD_LAYER,
      }),
    );
    this.score = this.add(new Score());
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const COIN_POSITIONS: readonly (readonly [x: number, y: number])[] = [
  [150, 150],
  [650, 150],
  [400, 100],
  [200, 450],
  [600, 450],
  [100, 300],
  [700, 300],
  [350, 500],
  [450, 200],
  [300, 350],
];

class CollisionsScene extends Scene {
  readonly name = "physics-collisions";
  readonly preload = [CoinSfx, HurtSfx];
  readonly layers: readonly LayerDef[] = [
    { name: HUD_LAYER, order: 1000, space: "screen" },
  ];

  // The scene only assembles the level. The HUD entity keeps the score and
  // the player respawns itself.
  onEnter(): void {
    this.spawn(HudEntity, { key: HUD_KEY });
    this.spawn(PlayerEntity);

    // Walls
    this.spawn(WallEntity, { x: WIDTH / 2, y: WALL / 2, w: WIDTH, h: WALL });
    this.spawn(WallEntity, {
      x: WIDTH / 2,
      y: HEIGHT - WALL / 2,
      w: WIDTH,
      h: WALL,
    });
    this.spawn(WallEntity, { x: WALL / 2, y: HEIGHT / 2, w: WALL, h: HEIGHT });
    this.spawn(WallEntity, {
      x: WIDTH - WALL / 2,
      y: HEIGHT / 2,
      w: WALL,
      h: HEIGHT,
    });

    // Coins
    for (const [x, y] of COIN_POSITIONS) {
      this.spawn(CoinEntity, { x, y });
    }

    // Danger zones
    this.spawn(DangerEntity, { x: 200, y: 250, w: 80, h: 60 });
    this.spawn(DangerEntity, { x: 580, y: 380, w: 100, h: 50 });
    this.spawn(DangerEntity, { x: 400, y: 450, w: 60, h: 80 });
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
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 0 } }));
  engine.use(new AudioPlugin());
  engine.use(
    new InputPlugin({
      actions: {
        up: ["KeyW", "ArrowUp"],
        down: ["KeyS", "ArrowDown"],
        left: ["KeyA", "ArrowLeft"],
        right: ["KeyD", "ArrowRight"],
      },
    }),
  );
  await installDebugFromUrl(engine);

  await engine.start();
  await engine.scenes.push(new CollisionsScene());
}

main().catch(console.error);
