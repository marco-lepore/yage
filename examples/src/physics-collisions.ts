import { Engine, Scene, Component, Transform, Vec2, defineEvent, defineBlueprint } from "@yage/core";
import { RendererPlugin, GraphicsComponent, CameraKey } from "@yage/renderer";
import {
  PhysicsPlugin,
  RigidBodyComponent,
  ColliderComponent,
  CollisionLayers,
} from "@yage/physics";
import { AudioPlugin, AudioManagerKey, sound } from "@yage/audio";
import { InputPlugin, InputManagerKey } from "@yage/input";
import { DebugPlugin } from "@yage/debug";
import { injectStyles, getContainer } from "./shared.js";

injectStyles(`
  #hud {
    position: fixed;
    top: 1rem;
    right: 1rem;
    background: rgba(0,0,0,0.7);
    color: #ffe66d;
    font-family: monospace;
    font-size: 1.2rem;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    pointer-events: none;
  }
`);

// Create a HUD element for the score
const hud = document.createElement("div");
hud.id = "hud";
hud.textContent = "Score: 0";
document.body.appendChild(hud);

const WIDTH = 800;
const HEIGHT = 600;
const WALL = 16;
const PLAYER_SPEED = 200; // px per second
const START_POS = new Vec2(WIDTH / 2, HEIGHT / 2);

// Collision layer setup
const layers = new CollisionLayers();
const LAYER_PLAYER = layers.define("player");
const LAYER_WALL = layers.define("wall");
const LAYER_COIN = layers.define("coin");
const LAYER_DANGER = layers.define("danger");

let score = 0;

function setScore(v: number): void {
  score = v;
  hud.textContent = `Score: ${score}`;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
const CoinCollected = defineEvent("coin:collected");
const DangerEntered = defineEvent("danger:entered");

// ---------------------------------------------------------------------------
// Sound asset handles
// ---------------------------------------------------------------------------
const CoinSfx = sound("assets/coin.wav");
const HurtSfx = sound("assets/hurt.wav");

// ---------------------------------------------------------------------------
// PlayerController — WASD dynamic movement via velocity
// ---------------------------------------------------------------------------
class PlayerController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly rb = this.sibling(RigidBodyComponent);

  update(): void {
    const dir = this.input.getVector("left", "right", "up", "down");
    if (dir.x !== 0 || dir.y !== 0) {
      this.rb.setVelocity(dir.normalize().scale(PLAYER_SPEED));
    } else {
      this.rb.setVelocity(Vec2.ZERO);
    }
  }
}

// ---------------------------------------------------------------------------
// Blueprints
// ---------------------------------------------------------------------------
const PlayerBP = defineBlueprint("player", (entity) => {
  entity.add(new Transform({ position: new Vec2(START_POS.x, START_POS.y) }));
  entity.add(
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
  entity.add(
    new RigidBodyComponent({
      type: "dynamic",
      fixedRotation: true,
      gravityScale: 0,
      linearDamping: 20,
    }),
  );
  entity.add(
    new ColliderComponent({
      shape: { type: "circle", radius: 16 },
      sensor: false,
      layers: LAYER_PLAYER,
      mask: LAYER_WALL | LAYER_COIN | LAYER_DANGER,
    }),
  );
  entity.add(new PlayerController());
});

const WallBP = defineBlueprint<{ x: number; y: number; w: number; h: number }>(
  "wall",
  (entity, { x, y, w, h }) => {
    entity.add(new Transform({ position: new Vec2(x, y) }));
    entity.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color: 0x555555 });
      }),
    );
    entity.add(new RigidBodyComponent({ type: "static" }));
    entity.add(
      new ColliderComponent({
        shape: { type: "box", width: w, height: h },
        layers: LAYER_WALL,
        mask: LAYER_PLAYER,
      }),
    );
  },
);

const CoinBP = defineBlueprint<{ x: number; y: number }>(
  "coin",
  (entity, { x, y }) => {
    entity.add(new Transform({ position: new Vec2(x, y) }));
    entity.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 10).fill({ color: 0xffe66d });
        g.circle(0, 0, 10).stroke({ color: 0xeab308, width: 2 });
        g.circle(0, 0, 4).fill({ color: 0xeab308, alpha: 0.6 });
      }),
    );
    entity.add(new RigidBodyComponent({ type: "static", fixedRotation: true }));
    const collider = new ColliderComponent({
      shape: { type: "circle", radius: 10 },
      sensor: true,
      layers: LAYER_COIN,
      mask: LAYER_PLAYER,
    });
    entity.add(collider);

    collider.onTrigger((ev) => {
      if (ev.entered) {
        entity.emit(CoinCollected);
        entity.destroy();
      }
    });
  },
);

const DangerBP = defineBlueprint<{ x: number; y: number; w: number; h: number }>(
  "danger",
  (entity, { x, y, w, h }) => {
    entity.add(new Transform({ position: new Vec2(x, y) }));
    entity.add(
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
    entity.add(new RigidBodyComponent({ type: "static", fixedRotation: true }));
    const collider = new ColliderComponent({
      shape: { type: "box", width: w, height: h },
      sensor: true,
      layers: LAYER_DANGER,
      mask: LAYER_PLAYER,
    });
    entity.add(collider);

    collider.onTrigger((ev) => {
      if (ev.entered) {
        entity.emit(DangerEntered);
      }
    });
  },
);

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class CollisionsScene extends Scene {
  readonly name = "physics-collisions";
  readonly preload = [CoinSfx, HurtSfx];

  private readonly audio = this.service(AudioManagerKey);
  private readonly camera = this.service(CameraKey);

  onEnter(): void {
    this.camera.position = new Vec2(WIDTH / 2, HEIGHT / 2);

    setScore(0);

    // Scene-level event listeners
    this.on(CoinCollected, () => {
      setScore(score + 10);
      this.audio.play(CoinSfx.path, { channel: "sfx" });
    });
    this.on(DangerEntered, () => {
      this.audio.play(HurtSfx.path, { channel: "sfx" });
      setScore(0);
      const player = this.findEntity("player");
      if (player) {
        const rb = player.get(RigidBodyComponent);
        rb.setPosition(START_POS.x, START_POS.y);
        player.get(Transform).setPosition(START_POS.x, START_POS.y);
      }
    });

    // Player
    this.spawn(PlayerBP);

    // Walls
    this.spawn(WallBP, { x: WIDTH / 2, y: WALL / 2, w: WIDTH, h: WALL }); // top
    this.spawn(WallBP, { x: WIDTH / 2, y: HEIGHT - WALL / 2, w: WIDTH, h: WALL }); // bottom
    this.spawn(WallBP, { x: WALL / 2, y: HEIGHT / 2, w: WALL, h: HEIGHT }); // left
    this.spawn(WallBP, { x: WIDTH - WALL / 2, y: HEIGHT / 2, w: WALL, h: HEIGHT }); // right

    // Coins
    const coinPositions = [
      [150, 150], [650, 150], [400, 100], [200, 450], [600, 450],
      [100, 300], [700, 300], [350, 500], [450, 200], [300, 350],
    ];
    for (const [x, y] of coinPositions) {
      this.spawn(CoinBP, { x: x!, y: y! });
    }

    // Danger zones
    this.spawn(DangerBP, { x: 200, y: 250, w: 80, h: 60 });
    this.spawn(DangerBP, { x: 580, y: 380, w: 100, h: 50 });
    this.spawn(DangerBP, { x: 400, y: 450, w: 60, h: 80 });
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const engine = new Engine({ debug: true });

  engine.use(new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0a0a0a,
    container: getContainer(),
  }));
  engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 0 } }));
  engine.use(new AudioPlugin());
  engine.use(new InputPlugin({
    actions: {
      up: ["KeyW", "ArrowUp"],
      down: ["KeyS", "ArrowDown"],
      left: ["KeyA", "ArrowLeft"],
      right: ["KeyD", "ArrowRight"],
    },
  }));
  engine.use(new DebugPlugin());

  await engine.start();
  engine.scenes.push(new CollisionsScene());
}

main().catch(console.error);
