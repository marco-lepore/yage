import { Engine, Scene, Component, Transform, Vec2 } from "@yage/core";
import { RendererPlugin, GraphicsComponent, CameraKey } from "@yage/renderer";
import {
  PhysicsPlugin,
  RigidBodyComponent,
  ColliderComponent,
  CollisionLayers,
} from "@yage/physics";
import { injectStyles, keys, getContainer } from "./shared.js";

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
// PlayerController — WASD dynamic movement via velocity
// ---------------------------------------------------------------------------
class PlayerController extends Component {
  update(_dt: number): void {
    const rb = this.entity.get(RigidBodyComponent);
    let dx = 0;
    let dy = 0;
    if (keys.has("w") || keys.has("arrowup")) dy -= 1;
    if (keys.has("s") || keys.has("arrowdown")) dy += 1;
    if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
    if (keys.has("d") || keys.has("arrowright")) dx += 1;

    if (dx !== 0 || dy !== 0) {
      rb.setVelocity(new Vec2(dx, dy).normalize().scale(PLAYER_SPEED));
    } else {
      rb.setVelocity(Vec2.ZERO);
    }
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class CollisionsScene extends Scene {
  readonly name = "physics-collisions";

  onEnter(): void {
    // Center camera on the arena
    const camera = this.context.resolve(CameraKey);
    camera.position = new Vec2(WIDTH / 2, HEIGHT / 2);

    setScore(0);

    // Player
    this.spawnPlayer();

    // Walls
    this.createWall(WIDTH / 2, WALL / 2, WIDTH, WALL); // top
    this.createWall(WIDTH / 2, HEIGHT - WALL / 2, WIDTH, WALL); // bottom
    this.createWall(WALL / 2, HEIGHT / 2, WALL, HEIGHT); // left
    this.createWall(WIDTH - WALL / 2, HEIGHT / 2, WALL, HEIGHT); // right

    // Coins
    const coinPositions = [
      [150, 150], [650, 150], [400, 100], [200, 450], [600, 450],
      [100, 300], [700, 300], [350, 500], [450, 200], [300, 350],
    ];
    for (let i = 0; i < coinPositions.length; i++) {
      const [x, y] = coinPositions[i]!;
      this.spawnCoin(x!, y!, i);
    }

    // Danger zones
    this.spawnDanger(200, 250, 80, 60);
    this.spawnDanger(580, 380, 100, 50);
    this.spawnDanger(400, 450, 60, 80);
  }

  private spawnPlayer(): void {
    const player = this.spawn("player");
    player.add(new Transform({ position: new Vec2(START_POS.x, START_POS.y) }));
    player.add(
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
    player.add(
      new RigidBodyComponent({
        type: "dynamic",
        fixedRotation: true,
        gravityScale: 0,
        linearDamping: 20,
      }),
    );
    player.add(
      new ColliderComponent({
        shape: { type: "circle", radius: 16 },
        sensor: false,
        layers: LAYER_PLAYER,
        mask: LAYER_WALL | LAYER_COIN | LAYER_DANGER,
      }),
    );
    player.add(new PlayerController());
  }

  private createWall(x: number, y: number, w: number, h: number): void {
    const e = this.spawn("wall");
    e.add(new Transform({ position: new Vec2(x, y) }));
    e.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color: 0x555555 });
      }),
    );
    e.add(new RigidBodyComponent({ type: "static" }));
    e.add(
      new ColliderComponent({
        shape: { type: "box", width: w, height: h },
        layers: LAYER_WALL,
        mask: LAYER_PLAYER,
      }),
    );
  }

  private spawnCoin(x: number, y: number, idx: number): void {
    const coin = this.spawn(`coin-${idx}`);
    coin.add(new Transform({ position: new Vec2(x, y) }));
    coin.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 10).fill({ color: 0xffe66d });
        g.circle(0, 0, 10).stroke({ color: 0xeab308, width: 2 });
        g.circle(0, 0, 4).fill({ color: 0xeab308, alpha: 0.6 });
      }),
    );
    coin.add(new RigidBodyComponent({ type: "static", fixedRotation: true }));
    const collider = new ColliderComponent({
      shape: { type: "circle", radius: 10 },
      sensor: true,
      layers: LAYER_COIN,
      mask: LAYER_PLAYER, // only interact with player
    });
    coin.add(collider);

    collider.onTrigger((ev) => {
      if (ev.entered) {
        setScore(score + 10);
        this.destroyEntity(coin);
      }
    });
  }

  private spawnDanger(x: number, y: number, w: number, h: number): void {
    const danger = this.spawn("danger");
    danger.add(new Transform({ position: new Vec2(x, y) }));
    danger.add(
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
    danger.add(new RigidBodyComponent({ type: "static", fixedRotation: true }));
    const collider = new ColliderComponent({
      shape: { type: "box", width: w, height: h },
      sensor: true,
      layers: LAYER_DANGER,
      mask: LAYER_PLAYER, // only interact with player
    });
    danger.add(collider);

    collider.onTrigger((ev) => {
      if (ev.entered) {
        setScore(0);
        // Teleport player back to start
        const player = this.findEntity("player");
        if (player) {
          const rb = player.get(RigidBodyComponent);
          rb.setPosition(START_POS.x, START_POS.y);
          player.get(Transform).setPosition(START_POS.x, START_POS.y);
        }
      }
    });
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
  engine.use(
    new PhysicsPlugin({
      gravity: { x: 0, y: 0 }, // top-down, no gravity
    }),
  );

  await engine.start();
  engine.scenes.push(new CollisionsScene());
}

main().catch(console.error);
