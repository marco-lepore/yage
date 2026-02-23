import { Engine, Scene, Component, Transform, Vec2 } from "@yage/core";
import {
  RendererPlugin,
  GraphicsComponent,
  CameraKey,
  RenderLayerManagerKey,
} from "@yage/renderer";
import type { Camera } from "@yage/renderer";
import {
  PhysicsPlugin,
  PhysicsWorld,
  RigidBodyComponent,
  ColliderComponent,
  CollisionLayers,
  PhysicsWorldKey,
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
  #win-message {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0,0,0,0.85);
    color: #22c55e;
    font-family: system-ui, sans-serif;
    font-size: 2rem;
    padding: 2rem 3rem;
    border-radius: 12px;
    border: 2px solid #22c55e;
    text-align: center;
    pointer-events: none;
    display: none;
  }
  #win-message .sub {
    font-size: 1rem;
    color: #ffe66d;
    margin-top: 0.5rem;
  }
`);

// HUD
const hud = document.createElement("div");
hud.id = "hud";
hud.textContent = "Coins: 0 / 8";
document.body.appendChild(hud);

// Win message
const winMsg = document.createElement("div");
winMsg.id = "win-message";
winMsg.innerHTML = `You Win!<div class="sub"></div>`;
document.body.appendChild(winMsg);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WIDTH = 800;
const HEIGHT = 600;
const WORLD_W = 2400;
const WORLD_H = 800;
const TOTAL_COINS = 8;
const SPAWN = new Vec2(100, 600);

// Collision layers
const layers = new CollisionLayers();
const LAYER_PLAYER = layers.define("player");
const LAYER_PLATFORM = layers.define("platform");
const LAYER_COIN = layers.define("coin");
const LAYER_GOAL = layers.define("goal");
const LAYER_DEATH = layers.define("death");

// State
let coins = 0;
let won = false;

function setCoins(n: number): void {
  coins = n;
  hud.textContent = `Coins: ${coins} / ${TOTAL_COINS}`;
}

function showWin(): void {
  if (won) return;
  won = true;
  const sub = winMsg.querySelector(".sub") as HTMLElement;
  sub.textContent = `Collected ${coins} / ${TOTAL_COINS} coins`;
  winMsg.style.display = "block";
}

// ---------------------------------------------------------------------------
// Triangle wave for ping-pong lerp: 0→1→0→1…
// ---------------------------------------------------------------------------
function triangleWave(t: number): number {
  const frac = t - Math.floor(t);
  return frac < 0.5 ? frac * 2 : 2 - frac * 2;
}

// ---------------------------------------------------------------------------
// MovingPlatform — kinematic body ping-ponging between two positions
// ---------------------------------------------------------------------------
class MovingPlatform extends Component {
  private startPos: Vec2;
  private endPos: Vec2;
  private period: number; // seconds for full cycle
  private elapsed = 0;
  private prevPos: Vec2;

  /** Platform velocity in px/s, readable by PlayerController. */
  velocity: Vec2 = Vec2.ZERO;

  constructor(startPos: Vec2, endPos: Vec2, period: number) {
    super();
    this.startPos = startPos;
    this.endPos = endPos;
    this.period = period;
    this.prevPos = new Vec2(startPos.x, startPos.y);
  }

  update(dt: number): void {
    this.elapsed += dt / 1000;
    const t = triangleWave(this.elapsed / this.period);
    const pos = this.startPos.lerp(this.endPos, t);
    this.entity.get(Transform).setPosition(pos.x, pos.y);

    const dtSec = dt / 1000;
    if (dtSec > 0) {
      this.velocity = new Vec2(
        (pos.x - this.prevPos.x) / dtSec,
        (pos.y - this.prevPos.y) / dtSec,
      );
    }
    this.prevPos = pos;
  }
}

// ---------------------------------------------------------------------------
// PlayerController
// ---------------------------------------------------------------------------
class PlayerController extends Component {
  private camera!: Camera;
  private physicsWorld!: PhysicsWorld;
  private graphics!: GraphicsComponent;

  private grounded = false;
  private coyoteTimer = 0; // ms remaining
  private jumpBufferTimer = 0; // ms remaining
  private wasAirborne = false;

  private static readonly SPEED = 220;
  // Jump velocity in px/s — derived from desired jump height:
  // v = sqrt(2 * gravity * height) = sqrt(2 * 980 * 130) ≈ 505
  private static readonly JUMP_VELOCITY = 505;
  private static readonly COYOTE_MS = 100;
  private static readonly JUMP_BUFFER_MS = 120;
  private static readonly GROUND_RAY_DIST = 22; // half-height(18) + 4px tolerance
  private static readonly WALL_RAY_DIST = 16; // half-width(12) + 4px tolerance

  onAdd(): void {
    this.camera = this.use(CameraKey);
    this.physicsWorld = this.use(PhysicsWorldKey);
    this.graphics = this.entity.get(GraphicsComponent);

    // Camera follow
    this.camera.follow(this.entity.get(Transform), {
      smoothing: 0.12,
      offset: new Vec2(0, -60),
      deadzone: { halfWidth: 60, halfHeight: 40 },
    });
    this.camera.bounds = {
      minX: 0,
      minY: 0,
      maxX: WORLD_W,
      maxY: WORLD_H,
    };
  }

  update(dt: number): void {
    if (won) return;

    const rb = this.entity.get(RigidBodyComponent);
    const vel = rb.getVelocity();

    // -- Ground detection via raycast --
    const pos = this.entity.get(Transform).position;
    const filterGroups = CollisionLayers.interactionGroups(
      LAYER_PLAYER,
      LAYER_PLATFORM,
    );
    const hit = this.physicsWorld.raycast(
      pos,
      Vec2.DOWN,
      PlayerController.GROUND_RAY_DIST,
      { filterGroups },
    );
    const onGround = hit !== null;

    if (onGround) {
      this.grounded = true;
      this.coyoteTimer = PlayerController.COYOTE_MS;
    } else {
      this.coyoteTimer -= dt;
      if (this.coyoteTimer <= 0) {
        this.grounded = false;
      }
    }

    // -- Platform carrying: inherit horizontal velocity from moving platform --
    let platformVelX = 0;
    if (hit) {
      const mover = hit.entity.tryGet(MovingPlatform);
      if (mover) platformVelX = mover.velocity.x;
    }

    // -- Horizontal movement --
    let dx = 0;
    if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
    if (keys.has("d") || keys.has("arrowright")) dx += 1;

    // -- Wall detection: don't push into walls while airborne --
    if (dx !== 0 && !onGround) {
      const wallDir = dx > 0 ? Vec2.RIGHT : Vec2.LEFT;
      const wallHit = this.physicsWorld.raycast(
        pos,
        wallDir,
        PlayerController.WALL_RAY_DIST,
        { filterGroups },
      );
      if (wallHit) dx = 0;
    }

    rb.setVelocity(
      new Vec2(dx * PlayerController.SPEED + platformVelX, vel.y),
    );

    // -- Jump buffering --
    if (keys.has(" ")) {
      this.jumpBufferTimer = PlayerController.JUMP_BUFFER_MS;
      keys.delete(" "); // consume to prevent held-jump
    } else {
      this.jumpBufferTimer -= dt;
    }

    // -- Jump execution --
    if (this.jumpBufferTimer > 0 && this.grounded) {
      // Set upward velocity directly — mass-independent and predictable.
      // Using setVelocity (px/s) instead of applyImpulse avoids needing to
      // account for body mass, which depends on collider area and density.
      rb.setVelocity(
        new Vec2(rb.getVelocity().x, -PlayerController.JUMP_VELOCITY),
      );
      this.grounded = false;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
    }

    // -- Visual swap based on airborne state --
    const airborne = !onGround;
    if (airborne !== this.wasAirborne) {
      this.wasAirborne = airborne;
      this.redrawPlayer(airborne);
    }
  }

  private redrawPlayer(airborne: boolean): void {
    const g = this.graphics.graphics;
    g.clear();
    drawPlayerGraphics(g, airborne);
  }
}

function drawPlayerGraphics(
  g: import("pixi.js").Graphics,
  airborne: boolean,
): void {
  const bodyColor = airborne ? 0x38bdf8 : 0x22c55e;
  const outlineColor = airborne ? 0x0ea5e9 : 0x16a34a;
  // Body
  g.rect(-12, -18, 24, 36).fill({ color: bodyColor });
  g.rect(-12, -18, 24, 36).stroke({ color: outlineColor, width: 2 });
  // Eyes
  g.circle(-4, -10, 2.5).fill({ color: 0xffffff });
  g.circle(4, -10, 2.5).fill({ color: 0xffffff });
  g.circle(-4, -10, 1.2).fill({ color: 0x111111 });
  g.circle(4, -10, 1.2).fill({ color: 0x111111 });
}

// ---------------------------------------------------------------------------
// PlatformerScene
// ---------------------------------------------------------------------------
class PlatformerScene extends Scene {
  readonly name = "platformer";

  onEnter(): void {
    const layerMgr = this.context.resolve(RenderLayerManagerKey);
    layerMgr.create("bg", -10);
    layerMgr.create("world", 0);
    layerMgr.create("player", 10);

    setCoins(0);
    won = false;
    winMsg.style.display = "none";

    this.drawBackground();
    this.buildLevel();
    this.spawnPlayer();
  }

  // -- Background grid --
  private drawBackground(): void {
    const bg = this.spawn("background");
    bg.add(new Transform());
    bg.add(
      new GraphicsComponent({ layer: "bg" }).draw((g) => {
        // Sky gradient feel via horizontal bands
        for (let y = 0; y < WORLD_H; y += 40) {
          const alpha = 0.03 + (y / WORLD_H) * 0.04;
          g.rect(0, y, WORLD_W, 40).fill({ color: 0x334155, alpha });
        }
        // Grid lines for depth/motion cue
        for (let x = 0; x <= WORLD_W; x += 100) {
          g.moveTo(x, 0)
            .lineTo(x, WORLD_H)
            .stroke({ color: 0x1e293b, width: 1 });
        }
        for (let y = 0; y <= WORLD_H; y += 100) {
          g.moveTo(0, y)
            .lineTo(WORLD_W, y)
            .stroke({ color: 0x1e293b, width: 1 });
        }
        // World boundary
        g.rect(0, 0, WORLD_W, WORLD_H).stroke({ color: 0x334155, width: 2 });
      }),
    );
  }

  // -- Player --
  private spawnPlayer(): void {
    const player = this.spawn("player");
    player.add(
      new Transform({ position: new Vec2(SPAWN.x, SPAWN.y) }),
    );
    player.add(
      new GraphicsComponent({ layer: "player" }).draw((g) => {
        drawPlayerGraphics(g, false);
      }),
    );
    player.add(
      new RigidBodyComponent({
        type: "dynamic",
        fixedRotation: true,
        ccd: true,
      }),
    );
    player.add(
      new ColliderComponent({
        shape: { type: "box", width: 24, height: 36 },
        friction: 0,
        layers: LAYER_PLAYER,
        mask:
          LAYER_PLATFORM |
          LAYER_COIN |
          LAYER_GOAL |
          LAYER_DEATH,
      }),
    );
    player.add(new PlayerController());
  }

  // -- Level geometry --
  private buildLevel(): void {
    // ============================================================
    // Section 1 (0–500): Start ground + 2 coins
    // ============================================================
    this.createPlatform(250, 750, 500, 100); // ground
    this.createCoin(200, 680, 0);
    this.createCoin(400, 650, 1);

    // ============================================================
    // Section 2 (500–900): Gap with stepping stones + 2 coins
    // ============================================================
    this.createDeathZone(700, 790, 400, 20); // pit death zone
    this.createPlatform(580, 700, 80, 20); // stepping stone 1
    this.createPlatform(700, 660, 80, 20); // stepping stone 2
    this.createPlatform(820, 620, 80, 20); // stepping stone 3
    this.createCoin(580, 670, 2);
    this.createCoin(820, 590, 3);

    // ============================================================
    // Section 3 (900–1400): Moving platforms + 1 coin
    // ============================================================
    this.createPlatform(950, 700, 120, 20); // landing after gap

    // Horizontal mover
    this.createMovingPlatform(
      new Vec2(1100, 650),
      new Vec2(1300, 650),
      100,
      20,
      3,
    );

    // Vertical mover
    this.createMovingPlatform(
      new Vec2(1350, 650),
      new Vec2(1350, 500),
      100,
      20,
      2.5,
    );

    this.createCoin(1200, 610, 4);

    // ============================================================
    // Section 4 (1400–1900): Ascending elevated platforms + 2 coins
    // ============================================================
    this.createPlatform(1450, 600, 120, 20);
    this.createPlatform(1580, 540, 120, 20);
    this.createPlatform(1720, 480, 120, 20);
    this.createPlatform(1860, 420, 140, 20);
    this.createCoin(1580, 510, 5);
    this.createCoin(1860, 390, 6);

    // ============================================================
    // Section 5 (1900–2400): Final run + vertical mover + goal
    // ============================================================
    this.createPlatform(2050, 500, 200, 20); // bridge from elevated

    // Vertical mover down to final ground
    this.createMovingPlatform(
      new Vec2(2200, 500),
      new Vec2(2200, 700),
      100,
      20,
      3,
    );

    this.createPlatform(2300, 750, 200, 100); // final ground
    this.createCoin(2200, 460, 7);
    this.createGoal(2350, 690);

    // ============================================================
    // World floor (catches player at very bottom except in pits)
    // ============================================================
    this.createPlatform(WORLD_W / 2, 795, WORLD_W, 10);

    // Left wall
    this.createPlatform(-5, WORLD_H / 2, 10, WORLD_H);
    // Right wall
    this.createPlatform(WORLD_W + 5, WORLD_H / 2, 10, WORLD_H);
  }

  // -- Helpers --

  private createPlatform(
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const e = this.spawn("platform");
    e.add(new Transform({ position: new Vec2(x, y) }));
    e.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color: 0x475569 });
        // Top surface highlight
        g.rect(-w / 2, -h / 2, w, 3).fill({ color: 0x64748b });
      }),
    );
    e.add(new RigidBodyComponent({ type: "static" }));
    e.add(
      new ColliderComponent({
        shape: { type: "box", width: w, height: h },
        friction: 0,
        layers: LAYER_PLATFORM,
        mask: LAYER_PLAYER,
      }),
    );
  }

  private createMovingPlatform(
    start: Vec2,
    end: Vec2,
    w: number,
    h: number,
    period: number,
  ): void {
    const e = this.spawn("moving-platform");
    e.add(new Transform({ position: new Vec2(start.x, start.y) }));
    e.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color: 0x7c3aed });
        // Top surface highlight
        g.rect(-w / 2, -h / 2, w, 3).fill({ color: 0xa78bfa });
        // Movement arrows
        g.circle(0, 0, 3).fill({ color: 0xa78bfa, alpha: 0.5 });
      }),
    );
    e.add(new RigidBodyComponent({ type: "kinematic" }));
    e.add(
      new ColliderComponent({
        shape: { type: "box", width: w, height: h },
        friction: 0,
        layers: LAYER_PLATFORM,
        mask: LAYER_PLAYER,
      }),
    );
    e.add(new MovingPlatform(start, end, period));
  }

  private createCoin(x: number, y: number, idx: number): void {
    const coin = this.spawn(`coin-${idx}`);
    coin.add(new Transform({ position: new Vec2(x, y) }));
    coin.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.circle(0, 0, 10).fill({ color: 0xffe66d });
        g.circle(0, 0, 10).stroke({ color: 0xeab308, width: 2 });
        g.circle(0, 0, 4).fill({ color: 0xeab308, alpha: 0.6 });
      }),
    );
    coin.add(
      new RigidBodyComponent({ type: "static", fixedRotation: true }),
    );
    const collider = new ColliderComponent({
      shape: { type: "circle", radius: 10 },
      sensor: true,
      layers: LAYER_COIN,
      mask: LAYER_PLAYER,
    });
    coin.add(collider);

    collider.onTrigger((ev) => {
      if (ev.entered) {
        setCoins(coins + 1);
        this.destroyEntity(coin);
      }
    });
  }

  private createDeathZone(
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const zone = this.spawn("death-zone");
    zone.add(new Transform({ position: new Vec2(x, y) }));
    zone.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color: 0xef4444, alpha: 0.3 });
        // Hazard stripes
        for (let i = -w / 2; i < w / 2; i += 12) {
          g.moveTo(i, -h / 2)
            .lineTo(i + 6, h / 2)
            .stroke({ color: 0xef4444, width: 1, alpha: 0.4 });
        }
      }),
    );
    zone.add(
      new RigidBodyComponent({ type: "static", fixedRotation: true }),
    );
    const collider = new ColliderComponent({
      shape: { type: "box", width: w, height: h },
      sensor: true,
      layers: LAYER_DEATH,
      mask: LAYER_PLAYER,
    });
    zone.add(collider);

    collider.onTrigger((ev) => {
      if (ev.entered) {
        const player = this.findEntity("player");
        if (player) {
          const rb = player.get(RigidBodyComponent);
          rb.setVelocity(Vec2.ZERO);
          rb.setPosition(SPAWN.x, SPAWN.y);
          player.get(Transform).setPosition(SPAWN.x, SPAWN.y);
        }
      }
    });
  }

  private createGoal(x: number, y: number): void {
    const goal = this.spawn("goal");
    goal.add(new Transform({ position: new Vec2(x, y) }));
    goal.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        // Flag pole
        g.rect(-2, -50, 4, 60).fill({ color: 0x94a3b8 });
        // Flag
        g.poly([2, -50, 30, -40, 2, -30]).fill({ color: 0x22c55e });
        // Base
        g.rect(-10, 8, 20, 4).fill({ color: 0x64748b });
      }),
    );
    goal.add(
      new RigidBodyComponent({ type: "static", fixedRotation: true }),
    );
    const collider = new ColliderComponent({
      shape: { type: "box", width: 30, height: 60 },
      sensor: true,
      layers: LAYER_GOAL,
      mask: LAYER_PLAYER,
    });
    goal.add(collider);

    collider.onTrigger((ev) => {
      if (ev.entered) {
        showWin();
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
      backgroundColor: 0x0f172a,
      container: getContainer(),
    }),
  );
  engine.use(
    new PhysicsPlugin({
      gravity: { x: 0, y: 980 },
    }),
  );

  await engine.start();
  engine.scenes.push(new PlatformerScene());
}

main().catch(console.error);
