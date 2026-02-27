import { Engine, Scene, Component, Transform, Vec2, ProcessComponent, Process, defineEvent, defineBlueprint } from "@yage/core";
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
    color: #ef4444;
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
    color: #38bdf8;
    margin-top: 0.5rem;
  }
`);

// HUD
const hud = document.createElement("div");
hud.id = "hud";
hud.textContent = "Enemies: 0 / 4";
document.body.appendChild(hud);

// Win message
const winMsg = document.createElement("div");
winMsg.id = "win-message";
winMsg.innerHTML = `You Win!<div class="sub">All enemies defeated</div>`;
document.body.appendChild(winMsg);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WIDTH = 800;
const HEIGHT = 600;
const WORLD_W = 1200;
const WORLD_H = 800;
const TOTAL_ENEMIES = 4;
const SPAWN = new Vec2(100, 680);

// Collision layers
const layers = new CollisionLayers();
const LAYER_PLAYER = layers.define("player");
const LAYER_PLATFORM = layers.define("platform");
const LAYER_BULLET = layers.define("bullet");
const LAYER_ENEMY = layers.define("enemy");

// State
let killCount = 0;
let won = false;

function setKills(n: number): void {
  killCount = n;
  hud.textContent = `Enemies: ${killCount} / ${TOTAL_ENEMIES}`;
}

function showWin(): void {
  if (won) return;
  won = true;
  winMsg.style.display = "block";
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
const Hurt = defineEvent<{ dir: number }>("hurt");
const EnemyKilled = defineEvent("enemy:killed");

// ---------------------------------------------------------------------------
// Particle spawning helpers
// ---------------------------------------------------------------------------
function spawnParticles(
  scene: Scene,
  x: number,
  y: number,
  count: number,
  color: number,
  spreadDeg: number,
  baseAngle: number,
  speedMin: number,
  speedMax: number,
  lifetimeMin: number,
  lifetimeMax: number,
  size: number,
): void {
  const spreadRad = (spreadDeg * Math.PI) / 180;
  for (let i = 0; i < count; i++) {
    const angle = baseAngle + (Math.random() - 0.5) * spreadRad;
    const speed = speedMin + Math.random() * (speedMax - speedMin);
    const lt = lifetimeMin + Math.random() * (lifetimeMax - lifetimeMin);
    const vel = Vec2.fromAngle(angle, speed);

    const p = scene.spawn("particle");
    p.add(new Transform({ position: new Vec2(x, y) }));
    p.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.circle(0, 0, size).fill({ color });
      }),
    );
    const transform = p.get(Transform);
    const gfx = p.get(GraphicsComponent);
    const pc = p.add(new ProcessComponent());
    pc.add(new Process({
      duration: lt,
      update: (dt, elapsed) => {
        const dtSec = dt / 1000;
        transform.translate(vel.x * dtSec, vel.y * dtSec);
        gfx.graphics.alpha = 1 - elapsed / lt;
      },
      onComplete: () => { p.destroy(); },
    }));
  }
}

function spawnBulletImpactParticles(
  scene: Scene,
  x: number,
  y: number,
  normalAngle: number,
): void {
  spawnParticles(
    scene, x, y,
    3 + Math.floor(Math.random() * 3), // 3-5
    0x38bdf8, 90, normalAngle,
    80, 150, 200, 350, 2,
  );
}

function spawnEnemyHitParticles(
  scene: Scene,
  x: number,
  y: number,
): void {
  spawnParticles(
    scene, x, y,
    4 + Math.floor(Math.random() * 3), // 4-6
    0xef4444, 120, Math.PI, // spread from left (arbitrary)
    60, 120, 250, 400, 2.5,
  );
}

function spawnEnemyDeathParticles(
  scene: Scene,
  x: number,
  y: number,
  color: number,
): void {
  spawnParticles(
    scene, x, y,
    8 + Math.floor(Math.random() * 5), // 8-12
    color, 360, 0,
    50, 200, 300, 500, 3,
  );
}

// ---------------------------------------------------------------------------
// PlayerController
// ---------------------------------------------------------------------------
class PlayerController extends Component {
  private camera!: Camera;
  private physicsWorld!: PhysicsWorld;
  private graphics!: GraphicsComponent;

  private grounded = false;
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private wasGrounded = false;
  facingRight = true;

  // Shooting
  private canShoot = true;

  // Hit flash / invincibility
  private invincible = false;

  private static readonly SPEED = 220;
  private static readonly JUMP_VELOCITY = 505;
  private static readonly COYOTE_MS = 100;
  private static readonly JUMP_BUFFER_MS = 120;
  private static readonly GROUND_RAY_DIST = 22;
  private static readonly WALL_RAY_DIST = 16;
  private static readonly SHOOT_COOLDOWN_MS = 200;

  private get pc(): ProcessComponent {
    return this.entity.get(ProcessComponent);
  }

  onAdd(): void {
    this.camera = this.use(CameraKey);
    this.physicsWorld = this.use(PhysicsWorldKey);
    this.graphics = this.entity.get(GraphicsComponent);

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

    // Handle contact damage from enemies
    const collider = this.entity.get(ColliderComponent);
    collider.onCollision((ev) => {
      if (ev.started && ev.other.tags.has("enemy")) {
        this.takeDamage();
      }
    });
  }

  update(dt: number): void {
    if (won) return;

    const rb = this.entity.get(RigidBodyComponent);
    const vel = rb.getVelocity();
    const pos = this.entity.get(Transform).position;

    // -- Ground detection --
    const filterGroups = CollisionLayers.interactionGroups(
      LAYER_PLAYER,
      LAYER_PLATFORM,
    );
    const hit = this.physicsWorld.raycast(
      pos, Vec2.DOWN, PlayerController.GROUND_RAY_DIST, { filterGroups },
    );
    const onGround = hit !== null;

    if (onGround) {
      this.grounded = true;
      this.coyoteTimer = PlayerController.COYOTE_MS;
    } else {
      this.coyoteTimer -= dt;
      if (this.coyoteTimer <= 0) this.grounded = false;
    }

    // -- Landing squash --
    if (onGround && !this.wasGrounded) {
      this.startSquash(1.3, 0.7);
    }
    this.wasGrounded = onGround;

    // -- Horizontal movement --
    let dx = 0;
    if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
    if (keys.has("d") || keys.has("arrowright")) dx += 1;

    // Track facing direction
    if (dx > 0) this.facingRight = true;
    else if (dx < 0) this.facingRight = false;

    // Wall detection
    if (dx !== 0 && !onGround) {
      const wallDir = dx > 0 ? Vec2.RIGHT : Vec2.LEFT;
      const wallHit = this.physicsWorld.raycast(
        pos, wallDir, PlayerController.WALL_RAY_DIST, { filterGroups },
      );
      if (wallHit) dx = 0;
    }

    rb.setVelocity(new Vec2(dx * PlayerController.SPEED, vel.y));

    // -- Jump buffering --
    if (keys.has(" ")) {
      this.jumpBufferTimer = PlayerController.JUMP_BUFFER_MS;
      keys.delete(" ");
    } else {
      this.jumpBufferTimer -= dt;
    }

    // -- Jump execution --
    if (this.jumpBufferTimer > 0 && this.grounded) {
      rb.setVelocity(
        new Vec2(rb.getVelocity().x, -PlayerController.JUMP_VELOCITY),
      );
      this.grounded = false;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;

      // Jump stretch
      this.startSquash(0.8, 1.2);
    }

    // -- Shooting --
    if ((keys.has("j") || keys.has("k")) && this.canShoot) {
      keys.delete("j");
      keys.delete("k");
      this.canShoot = false;
      this.pc.add(new Process({
        duration: PlayerController.SHOOT_COOLDOWN_MS,
        update: () => {},
        onComplete: () => { this.canShoot = true; },
      }));
      this.spawnBullet();
      this.camera.shake(2, 100, { decay: 0.8 });
    }

    // -- Visual flip for facing direction --
    const currentScale = this.entity.get(Transform).scale;
    const flipX = this.facingRight ? Math.abs(currentScale.x) : -Math.abs(currentScale.x);
    this.entity.get(Transform).setScale(flipX, currentScale.y);
  }

  private startSquash(scaleX: number, scaleY: number): void {
    this.pc.cancel("squash");
    const transform = this.entity.get(Transform);
    transform.setScale(scaleX, scaleY);
    this.pc.add(new Process({
      duration: 120,
      update: (_dt, elapsed) => {
        const t = Math.max(0, 1 - elapsed / 120);
        const sx = 1 + (scaleX - 1) * t;
        const sy = 1 + (scaleY - 1) * t;
        transform.setScale(sx, sy);
      },
      onComplete: () => { transform.setScale(1, 1); },
      tags: ["squash"],
    }));
  }

  private takeDamage(): void {
    if (this.invincible) return;
    this.invincible = true;

    // Flash red
    this.graphics.graphics.tint = 0xff4444;
    this.pc.cancel("flash");
    this.pc.add(new Process({
      duration: 100,
      update: () => {},
      onComplete: () => { this.graphics.graphics.tint = 0xffffff; },
      tags: ["flash"],
    }));

    // Invincibility
    this.pc.add(new Process({
      duration: 500,
      update: () => {},
      onComplete: () => { this.invincible = false; },
    }));

    this.camera.shake(5, 200, { decay: 0.7 });
  }

  private spawnBullet(): void {
    const scene = this.entity.scene;
    if (!scene) return;
    const pos = this.entity.get(Transform).position;
    const dir = this.facingRight ? 1 : -1;
    scene.spawn(BulletBP, { x: pos.x + dir * 16, y: pos.y, dir });
  }
}

// ---------------------------------------------------------------------------
// EnemyController — patrol + damage + death
// ---------------------------------------------------------------------------
const ENEMY_COLOR = 0xe11d48;
const ENEMY_OUTLINE = 0xbe123c;

class EnemyController extends Component {
  private physicsWorld!: PhysicsWorld;
  private camera!: Camera;
  private graphics!: GraphicsComponent;

  private hp = 3;
  private patrolDir = 1;
  private patrolLeft: number;
  private patrolRight: number;

  private dying = false;

  private static readonly SPEED = 60;

  private get pc(): ProcessComponent {
    return this.entity.get(ProcessComponent);
  }

  constructor(patrolLeft: number, patrolRight: number) {
    super();
    this.patrolLeft = patrolLeft;
    this.patrolRight = patrolRight;
  }

  onAdd(): void {
    this.physicsWorld = this.use(PhysicsWorldKey);
    this.camera = this.use(CameraKey);
    this.graphics = this.entity.get(GraphicsComponent);

    // React to damage events on this entity
    this.listen(this.entity, Hurt, ({ dir }) => this.takeDamage(dir));
  }

  update(): void {
    if (this.dying) return;

    const rb = this.entity.get(RigidBodyComponent);
    const pos = this.entity.get(Transform).position;

    // -- Patrol --
    // Reverse on patrol bounds
    if (pos.x <= this.patrolLeft) this.patrolDir = 1;
    else if (pos.x >= this.patrolRight) this.patrolDir = -1;

    // Wall raycast reversal
    const wallDir = this.patrolDir > 0 ? Vec2.RIGHT : Vec2.LEFT;
    const filterGroups = CollisionLayers.interactionGroups(
      LAYER_ENEMY,
      LAYER_PLATFORM,
    );
    const wallHit = this.physicsWorld.raycast(
      pos, wallDir, 18, { filterGroups },
    );
    if (wallHit) this.patrolDir *= -1;

    const vel = rb.getVelocity();
    rb.setVelocity(new Vec2(this.patrolDir * EnemyController.SPEED, vel.y));
  }

  private takeDamage(bulletDir: number): void {
    if (this.dying) return;

    this.hp--;

    // Knockback
    const rb = this.entity.get(RigidBodyComponent);
    const vel = rb.getVelocity();
    rb.setVelocity(new Vec2(bulletDir * 150, vel.y - 50));

    const pc = this.pc;
    const gfx = this.graphics.graphics;
    const transform = this.entity.get(Transform);

    // Flash white
    pc.cancel("flash");
    gfx.tint = 0xffffff;
    pc.add(new Process({
      duration: 80,
      update: () => {},
      onComplete: () => { gfx.tint = 0xffffff; },
      tags: ["flash"],
    }));

    // Shake
    pc.cancel("shake");
    gfx.position.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
    pc.add(new Process({
      duration: 150,
      update: () => {
        gfx.position.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
      },
      onComplete: () => { gfx.position.set(0, 0); },
      tags: ["shake"],
    }));

    // Shrink
    pc.cancel("shrink");
    transform.setScale(0.9, 0.9);
    pc.add(new Process({
      duration: 120,
      update: (_dt, elapsed) => {
        const t = Math.max(0, 1 - elapsed / 120);
        const s = 1 - 0.1 * t;
        transform.setScale(s, s);
      },
      onComplete: () => { transform.setScale(1, 1); },
      tags: ["shrink"],
    }));

    // Camera shake
    this.camera.shake(4, 150, { decay: 0.8 });

    if (this.hp <= 0) {
      this.die();
    }
  }

  private die(): void {
    this.dying = true;

    const pc = this.pc;
    pc.cancel(); // cancel all feedback processes
    this.graphics.graphics.tint = 0xffffff;
    this.graphics.graphics.position.set(0, 0);

    const pos = this.entity.get(Transform).position;
    if (this.entity.scene) {
      spawnEnemyDeathParticles(this.entity.scene, pos.x, pos.y, ENEMY_COLOR);
    }
    this.camera.shake(6, 250, { decay: 0.7 });

    const transform = this.entity.get(Transform);
    pc.add(new Process({
      duration: 150,
      update: (_dt, elapsed) => {
        const s = 1 - Math.min(elapsed / 150, 1);
        transform.setScale(s, s);
      },
      onComplete: () => {
        this.entity.destroy();
      },
    }));

    this.entity.emit(EnemyKilled);
  }
}

// ---------------------------------------------------------------------------
// Player drawing helper
// ---------------------------------------------------------------------------
function drawPlayerGraphics(g: import("pixi.js").Graphics): void {
  // Body
  g.rect(-12, -18, 24, 36).fill({ color: 0x22c55e });
  g.rect(-12, -18, 24, 36).stroke({ color: 0x16a34a, width: 2 });
  // Visor
  g.rect(4, -14, 8, 6).fill({ color: 0x38bdf8 });
  g.rect(4, -14, 8, 6).stroke({ color: 0x0ea5e9, width: 1 });
  // Arm cannon
  g.rect(8, -2, 8, 6).fill({ color: 0x475569 });
  g.rect(8, -2, 8, 6).stroke({ color: 0x334155, width: 1 });
}

function drawEnemyGraphics(g: import("pixi.js").Graphics): void {
  // Body
  g.rect(-14, -14, 28, 28).fill({ color: ENEMY_COLOR });
  g.rect(-14, -14, 28, 28).stroke({ color: ENEMY_OUTLINE, width: 2 });
  // Eyes
  g.circle(-5, -4, 3).fill({ color: 0xffffff });
  g.circle(5, -4, 3).fill({ color: 0xffffff });
  g.circle(-5, -4, 1.5).fill({ color: 0x111111 });
  g.circle(5, -4, 1.5).fill({ color: 0x111111 });
  // Teeth/mouth
  g.rect(-6, 4, 12, 3).fill({ color: 0xffffff });
}

// ---------------------------------------------------------------------------
// Blueprints
// ---------------------------------------------------------------------------
const PlayerBP = defineBlueprint("player", (entity) => {
  entity.add(new Transform({ position: new Vec2(SPAWN.x, SPAWN.y) }));
  entity.add(
    new GraphicsComponent({ layer: "player" }).draw(drawPlayerGraphics),
  );
  entity.add(
    new RigidBodyComponent({
      type: "dynamic",
      fixedRotation: true,
      ccd: true,
    }),
  );
  entity.add(
    new ColliderComponent({
      shape: { type: "box", width: 24, height: 36 },
      friction: 0,
      layers: LAYER_PLAYER,
      mask: LAYER_PLATFORM | LAYER_ENEMY,
    }),
  );
  entity.add(new ProcessComponent());
  entity.add(new PlayerController());
});

const PlatformBP = defineBlueprint<{ x: number; y: number; w: number; h: number }>(
  "platform",
  (entity, { x, y, w, h }) => {
    entity.add(new Transform({ position: new Vec2(x, y) }));
    entity.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color: 0x475569 });
        g.rect(-w / 2, -h / 2, w, 3).fill({ color: 0x64748b });
      }),
    );
    entity.add(new RigidBodyComponent({ type: "static" }));
    entity.add(
      new ColliderComponent({
        shape: { type: "box", width: w, height: h },
        friction: 0,
        layers: LAYER_PLATFORM,
        mask: LAYER_PLAYER | LAYER_BULLET | LAYER_ENEMY,
      }),
    );
  },
);

const EnemyBP = defineBlueprint<{
  x: number;
  y: number;
  patrolLeft: number;
  patrolRight: number;
}>(
  "enemy",
  (entity, { x, y, patrolLeft, patrolRight }) => {
    entity.tags.add("enemy");
    entity.add(new Transform({ position: new Vec2(x, y) }));
    entity.add(
      new GraphicsComponent({ layer: "world" }).draw(drawEnemyGraphics),
    );
    entity.add(
      new RigidBodyComponent({
        type: "dynamic",
        fixedRotation: true,
      }),
    );
    entity.add(
      new ColliderComponent({
        shape: { type: "box", width: 28, height: 28 },
        friction: 0,
        layers: LAYER_ENEMY,
        mask: LAYER_PLATFORM | LAYER_PLAYER | LAYER_BULLET,
      }),
    );
    entity.add(new ProcessComponent());
    entity.add(new EnemyController(patrolLeft, patrolRight));
  },
);

const BulletBP = defineBlueprint<{ x: number; y: number; dir: number }>(
  "bullet",
  (entity, { x, y, dir }) => {
    entity.tags.add("bullet");
    entity.add(new Transform({ position: new Vec2(x, y) }));
    entity.add(
      new GraphicsComponent({ layer: "bullets" }).draw((g) => {
        g.rect(-4, -2, 8, 4).fill({ color: 0x38bdf8 });
      }),
    );
    entity.add(
      new RigidBodyComponent({
        type: "dynamic",
        fixedRotation: true,
        gravityScale: 0,
        ccd: true,
      }),
    );

    const collider = new ColliderComponent({
      shape: { type: "box", width: 8, height: 4 },
      friction: 0,
      layers: LAYER_BULLET,
      mask: LAYER_PLATFORM | LAYER_ENEMY,
    });
    entity.add(collider);

    // Self-destruct after 1200ms
    const pc = entity.add(new ProcessComponent());
    pc.add(new Process({
      duration: 1200,
      update: () => {},
      onComplete: () => { entity.destroy(); },
    }));

    // Set bullet velocity after body is created
    entity.get(RigidBodyComponent).setVelocity(new Vec2(dir * 600, 0));

    // Collision handler
    collider.onCollision((ev) => {
      if (!ev.started || !entity.scene) return;
      const scene = entity.scene;
      const bPos = entity.get(Transform).position;

      if (ev.other.tags.has("enemy")) {
        ev.other.emit(Hurt, { dir });
        spawnEnemyHitParticles(scene, bPos.x, bPos.y);
      } else {
        const normalAngle = dir > 0 ? Math.PI : 0;
        spawnBulletImpactParticles(scene, bPos.x, bPos.y, normalAngle);
      }
      entity.destroy();
    });
  },
);

// ---------------------------------------------------------------------------
// ShooterScene
// ---------------------------------------------------------------------------
class ShooterScene extends Scene {
  readonly name = "shooter";

  onEnter(): void {
    const layerMgr = this.context.resolve(RenderLayerManagerKey);
    layerMgr.create("bg", -10);
    layerMgr.create("world", 0);
    layerMgr.create("bullets", 5);
    layerMgr.create("player", 10);

    setKills(0);
    won = false;
    winMsg.style.display = "none";

    // Scene-level event listener: track enemy kills
    this.on(EnemyKilled, () => {
      setKills(killCount + 1);
      if (killCount >= TOTAL_ENEMIES) showWin();
    });

    this.drawBackground();
    this.buildLevel();
    this.spawnEnemies();
    this.spawn(PlayerBP);
  }

  // -- Background --
  private drawBackground(): void {
    const bg = this.spawn("background");
    bg.add(new Transform());
    bg.add(
      new GraphicsComponent({ layer: "bg" }).draw((g) => {
        for (let y = 0; y < WORLD_H; y += 40) {
          const alpha = 0.03 + (y / WORLD_H) * 0.04;
          g.rect(0, y, WORLD_W, 40).fill({ color: 0x334155, alpha });
        }
        for (let x = 0; x <= WORLD_W; x += 100) {
          g.moveTo(x, 0).lineTo(x, WORLD_H).stroke({ color: 0x1e293b, width: 1 });
        }
        for (let y = 0; y <= WORLD_H; y += 100) {
          g.moveTo(0, y).lineTo(WORLD_W, y).stroke({ color: 0x1e293b, width: 1 });
        }
        g.rect(0, 0, WORLD_W, WORLD_H).stroke({ color: 0x334155, width: 2 });
      }),
    );
  }

  // -- Level geometry --
  private buildLevel(): void {
    // Full-width ground floor
    this.spawn(PlatformBP, { x: WORLD_W / 2, y: 750, w: WORLD_W, h: 100 });

    // Left wall
    this.spawn(PlatformBP, { x: -5, y: WORLD_H / 2, w: 10, h: WORLD_H });
    // Right wall
    this.spawn(PlatformBP, { x: WORLD_W + 5, y: WORLD_H / 2, w: 10, h: WORLD_H });

    // Elevated platforms for verticality
    this.spawn(PlatformBP, { x: 300, y: 620, w: 120, h: 20 });   // lower-left platform
    this.spawn(PlatformBP, { x: 550, y: 540, w: 100, h: 20 });   // mid-left platform
    this.spawn(PlatformBP, { x: 800, y: 600, w: 140, h: 20 });   // mid-right platform
    this.spawn(PlatformBP, { x: 1000, y: 520, w: 120, h: 20 });  // upper-right platform
    this.spawn(PlatformBP, { x: 700, y: 440, w: 100, h: 20 });   // high central platform
  }

  // -- Enemies --
  private spawnEnemies(): void {
    this.spawn(EnemyBP, { x: 200, y: 680, patrolLeft: 100, patrolRight: 350 });     // ground left
    this.spawn(EnemyBP, { x: 500, y: 680, patrolLeft: 400, patrolRight: 650 });     // ground mid
    this.spawn(EnemyBP, { x: 850, y: 530, patrolLeft: 770, patrolRight: 940 });     // on mid-right platform
    this.spawn(EnemyBP, { x: 1050, y: 450, patrolLeft: 940, patrolRight: 1150 });   // on upper-right platform
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
  engine.scenes.push(new ShooterScene());
}

main().catch(console.error);
