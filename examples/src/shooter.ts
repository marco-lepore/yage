import {
  Engine,
  Scene,
  Component,
  Transform,
  Vec2,
  ProcessComponent,
  Process,
  defineEvent,
  defineBlueprint,
} from "@yage/core";
import {
  RendererPlugin,
  GraphicsComponent,
  AnimatedSpriteComponent,
  CameraKey,
  RenderLayerManagerKey,
  texture,
} from "@yage/renderer";
import type { Camera } from "@yage/renderer";
import { Texture, Rectangle } from "pixi.js";
import {
  PhysicsPlugin,
  PhysicsWorld,
  RigidBodyComponent,
  ColliderComponent,
  CollisionLayers,
  PhysicsWorldKey,
} from "@yage/physics";
import { AudioPlugin, AudioManagerKey, sound } from "@yage/audio";
import type { AudioManager } from "@yage/audio";
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
// Sound asset handles
// ---------------------------------------------------------------------------
const ShootSfx = sound("assets/laser_gun_shot.wav");
const HurtSfx = sound("assets/hurt.wav");
const ExplosionSfx = sound("assets/explosion.wav");
const JumpSfx = sound("assets/jump.wav");
const LandSfx = sound("assets/land.wav");
const BgMusic = sound("assets/bgm.mp3");

// ---------------------------------------------------------------------------
// Texture asset handles
// ---------------------------------------------------------------------------
const PlayerIdleTex = texture("assets/player_idle.png");
const PlayerWalkTex = texture("assets/player_walk.png");
const PlayerJumpTex = texture("assets/player_jump.png");
const PlayerLandTex = texture("assets/player_land.png");
const PlayerShootTex = texture("assets/player_shoot.png");
const PlayerHurtTex = texture("assets/player_hurt.png");

const EnemyIdleTex = texture("assets/skeleton_idle.png");
const EnemyWalkTex = texture("assets/skeleton_walk.png");
const EnemyReactTex = texture("assets/skeleton_react.png");
const EnemyAttackTex = texture("assets/skeleton_attack.png");
const EnemyHitTex = texture("assets/skeleton_hit.png");
const EnemyDieTex = texture("assets/skeleton_die.png");

const FRAME_SIZE = 48;

/** Slice a horizontal spritesheet into individual frame Textures. */
function sliceSheet(
  path: string,
  frameWidth: number,
  frameHeight?: number,
): Texture[] {
  const base = Texture.from(path);
  base.source.scaleMode = "nearest";
  const h = frameHeight ?? frameWidth;
  const count = Math.floor(base.width / frameWidth);
  const frames: Texture[] = [];
  for (let i = 0; i < count; i++) {
    frames.push(
      new Texture({
        source: base.source,
        frame: new Rectangle(i * frameWidth, 0, frameWidth, h),
      }),
    );
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WIDTH = 800;
const HEIGHT = 600;
const WORLD_W = 1200;
const WORLD_H = 800;
const TOTAL_ENEMIES = 6;
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
let playerEntity: import("@yage/core").Entity | null = null;

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
    pc.add(
      new Process({
        duration: lt,
        update: (dt, elapsed) => {
          const dtSec = dt / 1000;
          transform.translate(vel.x * dtSec, vel.y * dtSec);
          gfx.graphics.alpha = 1 - elapsed / lt;
        },
        onComplete: () => {
          p.destroy();
        },
      }),
    );
  }
}

function spawnBulletImpactParticles(
  scene: Scene,
  x: number,
  y: number,
  normalAngle: number,
): void {
  spawnParticles(
    scene,
    x,
    y,
    3 + Math.floor(Math.random() * 3), // 3-5
    0x38bdf8,
    90,
    normalAngle,
    80,
    150,
    200,
    350,
    2,
  );
}

function spawnEnemyHitParticles(scene: Scene, x: number, y: number): void {
  spawnParticles(
    scene,
    x,
    y,
    4 + Math.floor(Math.random() * 3), // 4-6
    0xef4444,
    120,
    Math.PI, // spread from left (arbitrary)
    60,
    120,
    250,
    400,
    2.5,
  );
}

function spawnEnemyDeathParticles(
  scene: Scene,
  x: number,
  y: number,
  color: number,
): void {
  spawnParticles(
    scene,
    x,
    y,
    8 + Math.floor(Math.random() * 5), // 8-12
    color,
    360,
    0,
    50,
    200,
    300,
    500,
    3,
  );
}

// ---------------------------------------------------------------------------
// PlayerController
// ---------------------------------------------------------------------------
type PlayerAnim = "idle" | "walk" | "jump" | "land" | "shoot" | "hurt";

class PlayerController extends Component {
  private camera!: Camera;
  private physicsWorld!: PhysicsWorld;
  private anim!: AnimatedSpriteComponent;
  private audio!: AudioManager;

  private animations!: Record<PlayerAnim, Texture[]>;
  private currentAnim = "";
  private animLocked = false;

  private grounded = false;
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private wasGrounded = false;
  facingRight = true;

  // Shooting
  private canShoot = true;

  // Hit flash / invincibility / stun
  private invincible = false;
  private stunned = false;
  private overlappingEnemies = new Set<import("@yage/core").Entity>();

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
    this.anim = this.entity.get(AnimatedSpriteComponent);
    this.audio = this.use(AudioManagerKey);

    // Build frame arrays from preloaded spritesheets
    this.animations = {
      idle: sliceSheet(PlayerIdleTex.path, FRAME_SIZE),
      walk: sliceSheet(PlayerWalkTex.path, FRAME_SIZE),
      jump: sliceSheet(PlayerJumpTex.path, FRAME_SIZE),
      land: sliceSheet(PlayerLandTex.path, FRAME_SIZE),
      shoot: sliceSheet(PlayerShootTex.path, FRAME_SIZE),
      hurt: sliceSheet(PlayerHurtTex.path, FRAME_SIZE),
    };

    this.playAnim("idle", 0.15, true);

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
      if (!ev.other.tags.has("enemy")) return;
      if (ev.started) {
        this.overlappingEnemies.add(ev.other);
        this.tryDamageFrom(ev.other);
      } else {
        this.overlappingEnemies.delete(ev.other);
      }
    });
  }

  update(dt: number): void {
    if (won) {
      this.entity.get(RigidBodyComponent).setVelocity(Vec2.ZERO);
      this.playAnim("idle", 0.15, true);
      return;
    }

    if (this.stunned) return;

    const rb = this.entity.get(RigidBodyComponent);
    const vel = rb.getVelocity();
    const pos = this.entity.get(Transform).position;

    // -- Ground detection --
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
      if (this.coyoteTimer <= 0) this.grounded = false;
    }

    // -- Landing squash (proportional to impact velocity) --
    if (onGround && !this.wasGrounded) {
      const impact = Math.min(vel.y / PlayerController.JUMP_VELOCITY, 1);
      const squashX = 1 + 0.3 * impact; // 1.0 – 1.3
      const squashY = 1 - 0.3 * impact; // 1.0 – 0.7
      if (impact > 0.15) {
        this.startSquash(squashX, squashY);
        this.playOneShot("land", 0.5, 120);
      }
      this.audio.play(LandSfx.path, { channel: "sfx" });
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
        pos,
        wallDir,
        PlayerController.WALL_RAY_DIST,
        { filterGroups },
      );
      if (wallHit) dx = 0;
    }

    const speed =
      this.currentAnim === "shoot"
        ? PlayerController.SPEED * 0.15
        : PlayerController.SPEED;
    rb.setVelocity(new Vec2(dx * speed, vel.y));

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
      this.audio.play(JumpSfx.path, { channel: "sfx" });
    }

    // -- Shooting --
    if ((keys.has("j") || keys.has("k")) && this.canShoot) {
      keys.delete("j");
      keys.delete("k");
      this.canShoot = false;
      this.pc.add(
        new Process({
          duration: PlayerController.SHOOT_COOLDOWN_MS,
          update: () => {},
          onComplete: () => {
            this.canShoot = true;
          },
        }),
      );
      this.spawnBullet();
      this.playOneShot("shoot", 0.4, PlayerController.SHOOT_COOLDOWN_MS);
      this.audio.play(ShootSfx.path, { channel: "sfx" });
      this.camera.shake(2, 100, { decay: 0.8 });
    }

    // -- Animation state (when not locked by one-shot) --
    if (!this.animLocked) {
      if (!onGround) {
        this.playAnim("jump", 0.12, false);
      } else if (dx !== 0) {
        this.playAnim("walk", 0.2, true);
      } else {
        this.playAnim("idle", 0.15, true);
      }
    }

    // -- Visual flip for facing direction --
    const currentScale = this.entity.get(Transform).scale;
    const flipX = this.facingRight
      ? Math.abs(currentScale.x)
      : -Math.abs(currentScale.x);
    this.entity.get(Transform).setScale(flipX, currentScale.y);
  }

  private playAnim(name: PlayerAnim, speed: number, loop: boolean): void {
    if (this.currentAnim === name) return;
    this.currentAnim = name;
    const as = this.anim.animatedSprite;
    as.textures = this.animations[name];
    as.loop = loop;
    as.animationSpeed = speed;
    as.gotoAndPlay(0);
  }

  private playOneShot(
    name: PlayerAnim,
    speed: number,
    durationMs: number,
  ): void {
    this.currentAnim = name;
    this.animLocked = true;
    const as = this.anim.animatedSprite;
    as.textures = this.animations[name];
    as.loop = false;
    as.animationSpeed = speed;
    as.gotoAndPlay(0);
    this.pc.cancel("anim-lock");
    this.pc.add(
      new Process({
        duration: durationMs,
        update: () => {},
        onComplete: () => {
          this.animLocked = false;
          this.currentAnim = "";
        },
        tags: ["anim-lock"],
      }),
    );
  }

  private startSquash(scaleX: number, scaleY: number): void {
    this.pc.cancel("squash");
    const transform = this.entity.get(Transform);
    transform.setScale(scaleX, scaleY);
    this.pc.add(
      new Process({
        duration: 120,
        update: (_dt, elapsed) => {
          const t = Math.max(0, 1 - elapsed / 120);
          const sx = 1 + (scaleX - 1) * t;
          const sy = 1 + (scaleY - 1) * t;
          transform.setScale(sx, sy);
        },
        onComplete: () => {
          transform.setScale(1, 1);
        },
        tags: ["squash"],
      }),
    );
  }

  private static readonly STUN_MS = 300;
  private static readonly KNOCKBACK_X = 200;
  private static readonly KNOCKBACK_Y = -180;

  private takeDamage(knockDir: number): void {
    if (this.invincible) return;
    this.invincible = true;
    this.stunned = true;

    // Knockback
    const rb = this.entity.get(RigidBodyComponent);
    rb.setVelocity(
      new Vec2(
        knockDir * PlayerController.KNOCKBACK_X,
        PlayerController.KNOCKBACK_Y,
      ),
    );

    // Flash red
    this.anim.animatedSprite.tint = 0xff4444;
    this.pc.cancel("flash");
    this.pc.add(
      new Process({
        duration: 100,
        update: () => {},
        onComplete: () => {
          this.anim.animatedSprite.tint = 0xffffff;
        },
        tags: ["flash"],
      }),
    );

    // Hurt animation + stun
    this.playOneShot("hurt", 0.3, PlayerController.STUN_MS);
    this.pc.cancel("stun");
    this.pc.add(
      new Process({
        duration: PlayerController.STUN_MS,
        update: () => {},
        onComplete: () => {
          this.stunned = false;
        },
        tags: ["stun"],
      }),
    );

    // Invincibility (lasts longer than stun)
    this.pc.add(
      new Process({
        duration: 500,
        update: () => {},
        onComplete: () => {
          this.invincible = false;
          // Re-check: still touching an enemy?
          for (const enemy of this.overlappingEnemies) {
            if (enemy.scene) {
              this.tryDamageFrom(enemy);
              break;
            }
          }
        },
      }),
    );

    this.camera.shake(5, 200, { decay: 0.7 });
  }

  private tryDamageFrom(enemy: import("@yage/core").Entity): void {
    if (this.invincible) return;
    const enemyX = enemy.get(Transform).position.x;
    const playerX = this.entity.get(Transform).position.x;
    const knockDir = playerX >= enemyX ? 1 : -1;
    this.takeDamage(knockDir);
  }

  private spawnBullet(): void {
    const scene = this.entity.scene;
    if (!scene) return;
    const pos = this.entity.get(Transform).position;
    const dir = this.facingRight ? 1 : -1;
    scene.spawn(BulletBP, { x: pos.x + dir * 18, y: pos.y - 6, dir });
  }
}

// ---------------------------------------------------------------------------
// EnemyController — state machine with animated sprites
// ---------------------------------------------------------------------------
const ENEMY_COLOR = 0xe11d48;

type EnemyState = "patrol" | "react" | "attack" | "cooldown" | "hit" | "die";
type EnemyAnim = "idle" | "walk" | "react" | "attack" | "hit" | "die";

/** Absolute pixel X of the skeleton's body center (consistent across sheets). */
const ENEMY_BODY_CENTER_X = 8;
/** Half the collider height — distance from entity center to feet. */
const ENEMY_HALF_H = 16; // collider is 32px tall

/** Per-animation anchors to keep the body center aligned across different frame sizes. */
const ENEMY_ANCHORS: Record<EnemyAnim, { x: number; y: number }> = {
  idle: { x: ENEMY_BODY_CENTER_X / 24, y: 1 - ENEMY_HALF_H / 32 },
  walk: { x: ENEMY_BODY_CENTER_X / 22, y: 1 - ENEMY_HALF_H / 33 },
  react: { x: ENEMY_BODY_CENTER_X / 22, y: 1 - ENEMY_HALF_H / 32 },
  attack: { x: ENEMY_BODY_CENTER_X / 43, y: 1 - ENEMY_HALF_H / 37 },
  hit: { x: ENEMY_BODY_CENTER_X / 30, y: 1 - ENEMY_HALF_H / 32 },
  die: { x: ENEMY_BODY_CENTER_X / 33, y: 1 - ENEMY_HALF_H / 32 },
};

class EnemyController extends Component {
  private physicsWorld!: PhysicsWorld;
  private camera!: Camera;
  private anim!: AnimatedSpriteComponent;
  private audio!: AudioManager;

  private animations!: Record<EnemyAnim, Texture[]>;
  private currentAnim = "";

  private hp = 3;
  private patrolDir = 1;
  private patrolLeft: number;
  private patrolRight: number;

  private state: EnemyState = "patrol";
  private targetX = 0;
  private cooldownTimer = 0;
  private attackTimer = 0;

  private static readonly SPEED = 60;
  private static readonly CHARGE_SPEED = 350;
  private static readonly DETECT_RANGE = 120;
  private static readonly DETECT_Y = 60;
  private static readonly REACT_DURATION = 200;
  private static readonly ATTACK_MAX_DURATION = 1000; // matches full 18-frame anim at speed 0.3
  private static readonly SLASH_FRAME_START = 4; // 0-based: movement begins
  private static readonly SLASH_FRAME_END = 9; // 0-based: movement ends (inclusive)
  private static readonly COOLDOWN_DURATION = 500;

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
    this.anim = this.entity.get(AnimatedSpriteComponent);
    this.audio = this.use(AudioManagerKey);

    // Build frame arrays from preloaded spritesheets
    this.animations = {
      idle: sliceSheet(EnemyIdleTex.path, 24, 32),
      walk: sliceSheet(EnemyWalkTex.path, 22, 33),
      react: sliceSheet(EnemyReactTex.path, 22, 32),
      attack: sliceSheet(EnemyAttackTex.path, 43, 37),
      hit: sliceSheet(EnemyHitTex.path, 30, 32),
      die: sliceSheet(EnemyDieTex.path, 33, 32),
    };

    this.playAnim("walk", 0.15, true);

    // React to damage events on this entity
    this.listen(this.entity, Hurt, ({ dir }) => this.takeDamage(dir));
  }

  update(dt: number): void {
    const rb = this.entity.get(RigidBodyComponent);
    const pos = this.entity.get(Transform).position;
    const vel = rb.getVelocity();

    switch (this.state) {
      case "patrol": {
        // Reverse on patrol bounds
        if (pos.x <= this.patrolLeft) this.patrolDir = 1;
        else if (pos.x >= this.patrolRight) this.patrolDir = -1;

        // Wall raycast reversal
        const wallDir = this.patrolDir > 0 ? Vec2.RIGHT : Vec2.LEFT;
        const filterGroups = CollisionLayers.interactionGroups(
          LAYER_ENEMY,
          LAYER_PLATFORM,
        );
        const wallHit = this.physicsWorld.raycast(pos, wallDir, 18, {
          filterGroups,
        });
        if (wallHit) this.patrolDir *= -1;

        rb.setVelocity(new Vec2(this.patrolDir * EnemyController.SPEED, vel.y));
        this.playAnim("walk", 0.15, true);
        this.updateFacing(this.patrolDir);

        // Detect player
        if (playerEntity && playerEntity.scene) {
          const playerPos = playerEntity.get(Transform).position;
          const dx = Math.abs(pos.x - playerPos.x);
          const dy = Math.abs(pos.y - playerPos.y);
          if (
            dx < EnemyController.DETECT_RANGE &&
            dy < EnemyController.DETECT_Y
          ) {
            this.enterReact(playerPos.x);
          }
        }
        break;
      }

      case "react":
        rb.setVelocity(new Vec2(0, vel.y));
        // Animation completion triggers transition to attack (set up in enterReact)
        break;

      case "attack": {
        this.attackTimer -= dt;
        if (this.attackTimer <= 0) {
          this.enterCooldown();
          break;
        }

        const frame = this.anim.animatedSprite.currentFrame;
        const inSlash =
          frame >= EnemyController.SLASH_FRAME_START &&
          frame <= EnemyController.SLASH_FRAME_END;

        if (inSlash) {
          const dir = this.targetX > pos.x ? 1 : -1;
          const wallDir = dir > 0 ? Vec2.RIGHT : Vec2.LEFT;
          const filterGroups = CollisionLayers.interactionGroups(
            LAYER_ENEMY,
            LAYER_PLATFORM,
          );
          const wallHit = this.physicsWorld.raycast(pos, wallDir, 18, {
            filterGroups,
          });
          if (wallHit) {
            rb.setVelocity(new Vec2(0, vel.y));
          } else {
            rb.setVelocity(new Vec2(dir * EnemyController.CHARGE_SPEED, vel.y));
          }
        } else {
          rb.setVelocity(new Vec2(0, vel.y));
        }
        break;
      }

      case "cooldown":
        rb.setVelocity(new Vec2(0, vel.y));
        this.cooldownTimer -= dt;
        if (this.cooldownTimer <= 0) {
          this.state = "patrol";
          this.playAnim("walk", 0.15, true);
        }
        break;

      case "hit":
        // Movement handled by knockback; wait for anim to complete (via process)
        break;

      case "die":
        rb.setVelocity(new Vec2(0, vel.y));
        break;
    }
  }

  private enterReact(playerX: number): void {
    this.state = "react";
    this.targetX = playerX;

    // Face toward player
    const pos = this.entity.get(Transform).position;
    this.updateFacing(playerX > pos.x ? 1 : -1);

    this.playAnim("react", 0.2, false);
    this.pc.cancel("state-transition");
    this.pc.add(
      new Process({
        duration: EnemyController.REACT_DURATION,
        update: () => {},
        onComplete: () => {
          if (this.state === "react") this.enterAttack();
        },
        tags: ["state-transition"],
      }),
    );
  }

  private enterAttack(): void {
    const pos = this.entity.get(Transform).position;

    this.state = "attack";
    this.attackTimer = EnemyController.ATTACK_MAX_DURATION;

    this.updateFacing(this.targetX > pos.x ? 1 : -1);

    this.playAnim("attack", 0.3, false);
  }

  private enterCooldown(): void {
    this.state = "cooldown";
    this.cooldownTimer = EnemyController.COOLDOWN_DURATION;
    this.entity
      .get(RigidBodyComponent)
      .setVelocity(
        new Vec2(0, this.entity.get(RigidBodyComponent).getVelocity().y),
      );
    this.playAnim("idle", 0.15, true);
  }

  private updateFacing(dir: number): void {
    const scale = this.entity.get(Transform).scale;
    const flipX = dir >= 0 ? Math.abs(scale.x) : -Math.abs(scale.x);
    this.entity.get(Transform).setScale(flipX, scale.y);
  }

  private playAnim(name: EnemyAnim, speed: number, loop: boolean): void {
    if (this.currentAnim === name) return;
    this.currentAnim = name;
    const as = this.anim.animatedSprite;
    as.textures = this.animations[name];
    const anchor = ENEMY_ANCHORS[name];
    as.anchor.set(anchor.x, anchor.y);
    as.loop = loop;
    as.animationSpeed = speed;
    as.gotoAndPlay(0);
  }

  private takeDamage(bulletDir: number): void {
    if (this.state === "die") return;

    this.hp--;
    this.audio.play(HurtSfx.path, { channel: "sfx" });

    // Knockback (light)
    const rb = this.entity.get(RigidBodyComponent);
    const vel = rb.getVelocity();
    rb.setVelocity(new Vec2(bulletDir * 30, vel.y - 10));

    // Face toward the bullet
    this.updateFacing(-bulletDir);

    if (this.hp <= 0) {
      this.die();
      return;
    }

    // Enter hit state
    this.state = "hit";
    this.pc.cancel("state-transition");

    const pc = this.pc;
    const sprite = this.anim.animatedSprite;

    // Flash white
    pc.cancel("flash");
    sprite.tint = 0xffffff;
    pc.add(
      new Process({
        duration: 80,
        update: () => {},
        onComplete: () => {
          sprite.tint = 0xffffff;
        },
        tags: ["flash"],
      }),
    );

    // Shake
    pc.cancel("shake");
    sprite.position.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
    pc.add(
      new Process({
        duration: 150,
        update: () => {
          sprite.position.set(
            (Math.random() - 0.5) * 4,
            (Math.random() - 0.5) * 4,
          );
        },
        onComplete: () => {
          sprite.position.set(0, 0);
        },
        tags: ["shake"],
      }),
    );

    // Play hit animation and return to patrol when done
    this.playAnim("hit", 0.25, false);
    const hitDuration = (this.animations.hit.length * (1000 / 60)) / 0.25; // frames / (fps * speed)
    pc.cancel("hit-recovery");
    pc.add(
      new Process({
        duration: Math.min(hitDuration, 400),
        update: () => {},
        onComplete: () => {
          if (this.state === "hit") {
            this.state = "patrol";
            this.currentAnim = "";
            this.playAnim("walk", 0.15, true);
          }
        },
        tags: ["hit-recovery"],
      }),
    );

    // Camera shake
    this.camera.shake(4, 150, { decay: 0.8 });
  }

  private die(): void {
    this.state = "die";
    this.audio.play(ExplosionSfx.path, { channel: "sfx" });

    // Stop blocking bullets and hurting the player
    this.entity.tags.delete("enemy");
    this.entity.tags.add("dead");
    this.entity.get(ColliderComponent).setSensor(true);

    const pc = this.pc;
    pc.cancel(); // cancel all feedback processes

    const sprite = this.anim.animatedSprite;
    sprite.tint = 0xffffff;
    sprite.position.set(0, 0);

    const pos = this.entity.get(Transform).position;
    if (this.entity.scene) {
      spawnEnemyDeathParticles(this.entity.scene, pos.x, pos.y, ENEMY_COLOR);
    }
    this.camera.shake(6, 250, { decay: 0.7 });

    // Play die animation, then destroy
    this.playAnim("die", 0.2, false);
    const dieDuration = (this.animations.die.length * (1000 / 60)) / 0.2;
    pc.add(
      new Process({
        duration: dieDuration,
        update: () => {},
        onComplete: () => {
          this.entity.destroy();
        },
      }),
    );

    this.entity.emit(EnemyKilled);
  }
}

// ---------------------------------------------------------------------------
// Blueprints
// ---------------------------------------------------------------------------
const PlayerBP = defineBlueprint("player", (entity) => {
  entity.add(new Transform({ position: new Vec2(SPAWN.x, SPAWN.y) }));
  const idleFrames = sliceSheet(PlayerIdleTex.path, FRAME_SIZE);
  const playerAnim = new AnimatedSpriteComponent({
    textures: idleFrames,
    layer: "player",
  });
  playerAnim.animatedSprite.anchor.set(0.5, 0.5 - 3 / FRAME_SIZE);
  entity.add(playerAnim);
  playerAnim.play({ speed: 0.15, loop: true });
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

const PlatformBP = defineBlueprint<{
  x: number;
  y: number;
  w: number;
  h: number;
}>("platform", (entity, { x, y, w, h }) => {
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
});

const EnemyBP = defineBlueprint<{
  x: number;
  y: number;
  patrolLeft: number;
  patrolRight: number;
}>("enemy", (entity, { x, y, patrolLeft, patrolRight }) => {
  entity.tags.add("enemy");
  entity.add(new Transform({ position: new Vec2(x, y) }));
  const idleFrames = sliceSheet(EnemyIdleTex.path, 24, 32);
  const enemyAnim = new AnimatedSpriteComponent({
    textures: idleFrames,
    layer: "world",
  });
  enemyAnim.animatedSprite.anchor.set(
    ENEMY_ANCHORS.idle.x,
    ENEMY_ANCHORS.idle.y,
  );
  entity.add(enemyAnim);
  enemyAnim.play({ speed: 0.15, loop: true });
  entity.add(
    new RigidBodyComponent({
      type: "dynamic",
      fixedRotation: true,
    }),
  );
  entity.add(
    new ColliderComponent({
      shape: { type: "box", width: 22, height: 32 },
      friction: 0,
      layers: LAYER_ENEMY,
      mask: LAYER_PLATFORM | LAYER_PLAYER | LAYER_BULLET,
    }),
  );
  entity.add(new ProcessComponent());
  entity.add(new EnemyController(patrolLeft, patrolRight));
});

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
    pc.add(
      new Process({
        duration: 1200,
        update: () => {},
        onComplete: () => {
          entity.destroy();
        },
      }),
    );

    // Set bullet velocity after body is created
    entity.get(RigidBodyComponent).setVelocity(new Vec2(dir * 600, 0));

    // Collision handler
    collider.onCollision((ev) => {
      if (!ev.started || !entity.scene) return;
      if (ev.other.tags.has("dead")) return; // ignore dying enemies
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
  readonly preload = [
    ShootSfx,
    HurtSfx,
    ExplosionSfx,
    JumpSfx,
    LandSfx,
    BgMusic,
    PlayerIdleTex,
    PlayerWalkTex,
    PlayerJumpTex,
    PlayerLandTex,
    PlayerShootTex,
    PlayerHurtTex,
    EnemyIdleTex,
    EnemyWalkTex,
    EnemyReactTex,
    EnemyAttackTex,
    EnemyHitTex,
    EnemyDieTex,
  ];

  onEnter(): void {
    const layerMgr = this.context.resolve(RenderLayerManagerKey);
    layerMgr.create("bg", -10);
    layerMgr.create("world", 0);
    layerMgr.create("bullets", 5);
    layerMgr.create("player", 10);

    setKills(0);
    won = false;
    winMsg.style.display = "none";

    // Background music
    const audio = this.context.resolve(AudioManagerKey);
    audio.play(BgMusic.path, { channel: "music", loop: true });

    // Scene-level event listener: track enemy kills
    this.on(EnemyKilled, () => {
      setKills(killCount + 1);
      if (killCount >= TOTAL_ENEMIES) showWin();
    });

    this.drawBackground();
    this.buildLevel();
    this.spawnEnemies();
    playerEntity = this.spawn(PlayerBP);
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
          g.moveTo(x, 0)
            .lineTo(x, WORLD_H)
            .stroke({ color: 0x1e293b, width: 1 });
        }
        for (let y = 0; y <= WORLD_H; y += 100) {
          g.moveTo(0, y)
            .lineTo(WORLD_W, y)
            .stroke({ color: 0x1e293b, width: 1 });
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
    this.spawn(PlatformBP, {
      x: WORLD_W + 5,
      y: WORLD_H / 2,
      w: 10,
      h: WORLD_H,
    });

    // Elevated platforms for verticality
    this.spawn(PlatformBP, { x: 300, y: 620, w: 120, h: 20 }); // lower-left platform
    this.spawn(PlatformBP, { x: 550, y: 540, w: 100, h: 20 }); // mid-left platform
    this.spawn(PlatformBP, { x: 800, y: 600, w: 140, h: 20 }); // mid-right platform
    this.spawn(PlatformBP, { x: 1000, y: 520, w: 120, h: 20 }); // upper-right platform
    this.spawn(PlatformBP, { x: 700, y: 440, w: 100, h: 20 }); // high central platform
  }

  // -- Enemies --
  private spawnEnemies(): void {
    this.spawn(EnemyBP, { x: 350, y: 680, patrolLeft: 200, patrolRight: 450 }); // ground left
    this.spawn(EnemyBP, { x: 600, y: 680, patrolLeft: 450, patrolRight: 750 }); // ground mid
    this.spawn(EnemyBP, { x: 950, y: 680, patrolLeft: 800, patrolRight: 1100 }); // ground right
    this.spawn(EnemyBP, { x: 550, y: 470, patrolLeft: 500, patrolRight: 600 }); // on mid-left platform
    this.spawn(EnemyBP, { x: 850, y: 530, patrolLeft: 770, patrolRight: 940 }); // on mid-right platform
    this.spawn(EnemyBP, {
      x: 1050,
      y: 450,
      patrolLeft: 940,
      patrolRight: 1150,
    }); // on upper-right platform
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
      pixi: { roundPixels: true },
    }),
  );
  engine.use(
    new PhysicsPlugin({
      gravity: { x: 0, y: 980 },
    }),
  );
  engine.use(new AudioPlugin());

  await engine.start();
  await engine.scenes.push(new ShooterScene());
}

main().catch(console.error);
