import { Engine, Scene, Entity, Component, Transform, Vec2, defineEvent } from "@yagejs/core";
import {
  RendererPlugin,
  GraphicsComponent,
  CameraEntity,
  type GraphicsContext,
  type LayerDef,
} from "@yagejs/renderer";
import {
  PhysicsPlugin,
  RigidBodyComponent,
  ColliderComponent,
  CollisionLayers,
  PhysicsWorldKey,
} from "@yagejs/physics";
import type { PhysicsWorld } from "@yagejs/physics";
import { AudioPlugin, AudioManagerKey, sound } from "@yagejs/audio";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, setupGameContainer } from "./shared.js";

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
// Events
// ---------------------------------------------------------------------------
const CoinCollected = defineEvent("coin:collected");
const PlayerDied = defineEvent("player:died");
const GoalReached = defineEvent("goal:reached");

// ---------------------------------------------------------------------------
// Sound asset handles
// ---------------------------------------------------------------------------
const JumpSfx = sound("/assets/jump.wav");
const LandSfx = sound("/assets/land.wav");
const CoinSfx = sound("/assets/coin.wav");
const HurtSfx = sound("/assets/hurt.wav");
const WinSfx = sound("/assets/win.wav");
const BgMusic = sound("/assets/bgm.mp3");

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
  private readonly transform = this.sibling(Transform);

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
    this.transform.setPosition(pos.x, pos.y);

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
  private readonly input = this.service(InputManagerKey);
  private readonly camera: CameraEntity;
  private physicsWorld!: PhysicsWorld;
  private readonly audio = this.service(AudioManagerKey);
  private readonly graphics = this.sibling(GraphicsComponent);
  private readonly transform = this.sibling(Transform);
  private readonly rb = this.sibling(RigidBodyComponent);

  constructor(camera: CameraEntity) {
    super();
    this.camera = camera;
  }

  private grounded = false;
  private coyoteTimer = 0; // ms remaining
  private jumpBufferTimer = 0; // ms remaining
  private wasAirborne = false;

  private static readonly SPEED = 220;
  private static readonly JUMP_VELOCITY = 505;
  private static readonly COYOTE_MS = 100;
  private static readonly JUMP_BUFFER_MS = 120;
  private static readonly GROUND_RAY_DIST = 22;
  private static readonly WALL_RAY_DIST = 16;

  onAdd(): void {
    this.physicsWorld = this.use(PhysicsWorldKey);

    // Camera follow
    this.camera.follow(this.transform, {
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

    const vel = this.rb.getVelocity();

    // -- Ground detection via raycast --
    const pos = this.transform.position;
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
    let dx = this.input.getAxis("left", "right");

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

    this.rb.setVelocity(
      new Vec2(dx * PlayerController.SPEED + platformVelX, vel.y),
    );

    // -- Jump buffering --
    if (this.input.isJustPressed("jump")) {
      this.jumpBufferTimer = PlayerController.JUMP_BUFFER_MS;
    } else {
      this.jumpBufferTimer -= dt;
    }

    // -- Jump execution --
    if (this.jumpBufferTimer > 0 && this.grounded) {
      this.rb.setVelocityY(-PlayerController.JUMP_VELOCITY);
      this.grounded = false;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
      this.audio.play(JumpSfx.path, { channel: "sfx" });
    }

    // -- Visual swap based on airborne state --
    const airborne = !onGround;
    if (airborne !== this.wasAirborne) {
      if (!airborne) this.audio.play(LandSfx.path, { channel: "sfx" });
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
  g: GraphicsContext,
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
// Entities
// ---------------------------------------------------------------------------
class PlayerEntity extends Entity {
  setup(params: { camera: CameraEntity }): void {
    this.add(new Transform({ position: new Vec2(SPAWN.x, SPAWN.y) }));
    this.add(
      new GraphicsComponent({ layer: "player" }).draw((g) => {
        drawPlayerGraphics(g, false);
      }),
    );
    this.add(
      new RigidBodyComponent({
        type: "dynamic",
        fixedRotation: true,
        ccd: true,
      }),
    );
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: 24, height: 36 },
        friction: 0,
        layers: LAYER_PLAYER,
        mask: LAYER_PLATFORM | LAYER_COIN | LAYER_GOAL | LAYER_DEATH,
      }),
    );
    this.add(new PlayerController(params.camera));
  }
}

class PlatformEntity extends Entity {
  setup(params: { x: number; y: number; w: number; h: number }): void {
    const { x, y, w, h } = params;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color: 0x475569 });
        // Top surface highlight
        g.rect(-w / 2, -h / 2, w, 3).fill({ color: 0x64748b });
      }),
    );
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: w, height: h },
        friction: 0,
        layers: LAYER_PLATFORM,
        mask: LAYER_PLAYER,
      }),
    );
  }
}

class MovingPlatformEntity extends Entity {
  setup(params: {
    start: Vec2;
    end: Vec2;
    w: number;
    h: number;
    period: number;
  }): void {
    const { start, end, w, h, period } = params;
    this.add(new Transform({ position: new Vec2(start.x, start.y) }));
    this.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color: 0x7c3aed });
        // Top surface highlight
        g.rect(-w / 2, -h / 2, w, 3).fill({ color: 0xa78bfa });
        // Movement arrows
        g.circle(0, 0, 3).fill({ color: 0xa78bfa, alpha: 0.5 });
      }),
    );
    this.add(new RigidBodyComponent({ type: "kinematic" }));
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: w, height: h },
        friction: 0,
        layers: LAYER_PLATFORM,
        mask: LAYER_PLAYER,
      }),
    );
    this.add(new MovingPlatform(start, end, period));
  }
}

class CoinEntity extends Entity {
  setup(params: { x: number; y: number }): void {
    const { x, y } = params;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
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

class DeathZoneEntity extends Entity {
  setup(params: { x: number; y: number; w: number; h: number }): void {
    const { x, y, w, h } = params;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
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
    this.add(new RigidBodyComponent({ type: "static", fixedRotation: true }));
    const collider = new ColliderComponent({
      shape: { type: "box", width: w, height: h },
      sensor: true,
      layers: LAYER_DEATH,
      mask: LAYER_PLAYER,
    });
    this.add(collider);

    collider.onTrigger((ev) => {
      if (ev.entered) {
        this.emit(PlayerDied);
      }
    });
  }
}

class GoalEntity extends Entity {
  setup(params: { x: number; y: number }): void {
    const { x, y } = params;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        // Flag pole
        g.rect(-2, -50, 4, 60).fill({ color: 0x94a3b8 });
        // Flag
        g.poly([2, -50, 30, -40, 2, -30]).fill({ color: 0x22c55e });
        // Base
        g.rect(-10, 8, 20, 4).fill({ color: 0x64748b });
      }),
    );
    this.add(new RigidBodyComponent({ type: "static", fixedRotation: true }));
    const collider = new ColliderComponent({
      shape: { type: "box", width: 30, height: 60 },
      sensor: true,
      layers: LAYER_GOAL,
      mask: LAYER_PLAYER,
    });
    this.add(collider);

    collider.onTrigger((ev) => {
      if (ev.entered) {
        this.emit(GoalReached);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// PlatformerScene
// ---------------------------------------------------------------------------
class PlatformerScene extends Scene {
  readonly name = "platformer";
  readonly preload = [JumpSfx, LandSfx, CoinSfx, HurtSfx, WinSfx, BgMusic];

  readonly layers: readonly LayerDef[] = [
    { name: "bg", order: -10 },
    { name: "world", order: 0 },
    { name: "player", order: 10 },
  ];

  private readonly audio = this.service(AudioManagerKey);

  onEnter(): void {
    setCoins(0);
    won = false;
    winMsg.style.display = "none";

    const cam = this.spawn(CameraEntity);

    // Background music
    this.audio.play(BgMusic.path, { channel: "music", loop: true });

    // Scene-level event listeners
    this.on(CoinCollected, () => {
      setCoins(coins + 1);
      this.audio.play(CoinSfx.path, { channel: "sfx" });
    });
    this.drawBackground();
    this.buildLevel();
    const player = this.spawn(PlayerEntity, { camera: cam });

    this.on(PlayerDied, () => {
      this.audio.play(HurtSfx.path, { channel: "sfx" });
      const rb = player.get(RigidBodyComponent);
      rb.setVelocity(Vec2.ZERO);
      rb.setPosition(SPAWN.x, SPAWN.y);
      player.get(Transform).setPosition(SPAWN.x, SPAWN.y);
    });
    this.on(GoalReached, () => {
      this.audio.play(WinSfx.path, { channel: "sfx" });
      showWin();
    });
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

  // -- Level geometry --
  private buildLevel(): void {
    // ============================================================
    // Section 1 (0–500): Start ground + 2 coins
    // ============================================================
    this.spawn(PlatformEntity, { x: 250, y: 750, w: 500, h: 100 }); // ground
    this.spawn(CoinEntity, { x: 200, y: 680 });
    this.spawn(CoinEntity, { x: 400, y: 650 });

    // ============================================================
    // Section 2 (500–900): Gap with stepping stones + 2 coins
    // ============================================================
    this.spawn(DeathZoneEntity, { x: 700, y: 790, w: 400, h: 20 }); // pit death zone
    this.spawn(PlatformEntity, { x: 580, y: 700, w: 80, h: 20 }); // stepping stone 1
    this.spawn(PlatformEntity, { x: 700, y: 660, w: 80, h: 20 }); // stepping stone 2
    this.spawn(PlatformEntity, { x: 820, y: 620, w: 80, h: 20 }); // stepping stone 3
    this.spawn(CoinEntity, { x: 580, y: 670 });
    this.spawn(CoinEntity, { x: 820, y: 590 });

    // ============================================================
    // Section 3 (900–1400): Moving platforms + 1 coin
    // ============================================================
    this.spawn(PlatformEntity, { x: 950, y: 700, w: 120, h: 20 }); // landing after gap

    // Horizontal mover
    this.spawn(MovingPlatformEntity, {
      start: new Vec2(1100, 650),
      end: new Vec2(1300, 650),
      w: 100,
      h: 20,
      period: 3,
    });

    // Vertical mover
    this.spawn(MovingPlatformEntity, {
      start: new Vec2(1350, 650),
      end: new Vec2(1350, 500),
      w: 100,
      h: 20,
      period: 2.5,
    });

    this.spawn(CoinEntity, { x: 1200, y: 610 });

    // ============================================================
    // Section 4 (1400–1900): Ascending elevated platforms + 2 coins
    // ============================================================
    this.spawn(PlatformEntity, { x: 1450, y: 600, w: 120, h: 20 });
    this.spawn(PlatformEntity, { x: 1580, y: 540, w: 120, h: 20 });
    this.spawn(PlatformEntity, { x: 1720, y: 480, w: 120, h: 20 });
    this.spawn(PlatformEntity, { x: 1860, y: 420, w: 140, h: 20 });
    this.spawn(CoinEntity, { x: 1580, y: 510 });
    this.spawn(CoinEntity, { x: 1860, y: 390 });

    // ============================================================
    // Section 5 (1900–2400): Final run + vertical mover + goal
    // ============================================================
    this.spawn(PlatformEntity, { x: 2050, y: 500, w: 200, h: 20 }); // bridge from elevated

    // Vertical mover down to final ground
    this.spawn(MovingPlatformEntity, {
      start: new Vec2(2200, 500),
      end: new Vec2(2200, 700),
      w: 100,
      h: 20,
      period: 3,
    });

    this.spawn(PlatformEntity, { x: 2300, y: 750, w: 200, h: 100 }); // final ground
    this.spawn(CoinEntity, { x: 2200, y: 460 });
    this.spawn(GoalEntity, { x: 2350, y: 690 });

    // ============================================================
    // World floor (catches player at very bottom except in pits)
    // ============================================================
    this.spawn(PlatformEntity, { x: WORLD_W / 2, y: 795, w: WORLD_W, h: 10 });

    // Left wall
    this.spawn(PlatformEntity, { x: -5, y: WORLD_H / 2, w: 10, h: WORLD_H });
    // Right wall
    this.spawn(PlatformEntity, { x: WORLD_W + 5, y: WORLD_H / 2, w: 10, h: WORLD_H });
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
    backgroundColor: 0x0f172a,
    container: setupGameContainer(WIDTH, HEIGHT),
  }));
  engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 980 } }));
  engine.use(new AudioPlugin());
  engine.use(new InputPlugin({
    actions: {
      left: ["KeyA", "ArrowLeft"],
      right: ["KeyD", "ArrowRight"],
      jump: ["Space"],
    },
    preventDefaultKeys: ["Space"],
  }));
  // Test fixtures opt into a fixed RNG seed so playback snapshots are
  // bit-identical across runs. Production builds leave it unset.
  const deterministicSeed = (
    globalThis as { __YAGE_DETERMINISTIC_SEED__?: number }
  ).__YAGE_DETERMINISTIC_SEED__;
  engine.use(
    new DebugPlugin(
      deterministicSeed !== undefined ? { deterministicSeed } : undefined,
    ),
  );

  await engine.start();
  const shouldStartFrozen = (
    globalThis as { __YAGE_START_FROZEN__?: boolean }
  ).__YAGE_START_FROZEN__;
  if (shouldStartFrozen) {
    engine.inspector.time.freeze();
  }
  await engine.scenes.push(new PlatformerScene());
}

main().catch(console.error);
