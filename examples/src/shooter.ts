import {
  Scene,
  Component,
  Transform,
  Vec2,
  ProcessComponent,
  Process,
  defineEvent,
  defineBlueprint,
} from "@yage/core";
import type { ProcessSlot } from "@yage/core";
import {
  GraphicsComponent,
  AnimatedSpriteComponent,
  AnimationController,
  CameraKey,
  RenderLayerManagerKey,
  texture,
  sliceSheet,
} from "@yage/renderer";
import {
  RigidBodyComponent,
  ColliderComponent,
  CollisionLayers,
  PhysicsWorldKey,
} from "@yage/physics";
import { AudioManagerKey, sound } from "@yage/audio";
import { createGame } from "yage";
import { injectStyles, keys } from "./shared.js";

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
const ShootSfx = sound("/assets/laser_gun_shot.wav");
const HurtSfx = sound("/assets/hurt.wav");
const ExplosionSfx = sound("/assets/explosion.wav");
const JumpSfx = sound("/assets/jump.wav");
const LandSfx = sound("/assets/land.wav");
const BgMusic = sound("/assets/bgm.mp3");

// ---------------------------------------------------------------------------
// Texture asset handles
// ---------------------------------------------------------------------------
const PlayerIdleTex = texture("/assets/player_idle.png");
const PlayerWalkTex = texture("/assets/player_walk.png");
const PlayerJumpTex = texture("/assets/player_jump.png");
const PlayerLandTex = texture("/assets/player_land.png");
const PlayerShootTex = texture("/assets/player_shoot.png");
const PlayerHurtTex = texture("/assets/player_hurt.png");

const EnemyIdleTex = texture("/assets/skeleton_idle.png");
const EnemyWalkTex = texture("/assets/skeleton_walk.png");
const EnemyReactTex = texture("/assets/skeleton_react.png");
const EnemyAttackTex = texture("/assets/skeleton_attack.png");
const EnemyHitTex = texture("/assets/skeleton_hit.png");
const EnemyDieTex = texture("/assets/skeleton_die.png");

const FRAME_SIZE = 48;

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
    pc.run(
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
  private readonly camera = this.service(CameraKey);
  private readonly physicsWorld = this.service(PhysicsWorldKey);
  private readonly audio = this.service(AudioManagerKey);
  private readonly anim = this.sibling(AnimationController) as AnimationController<PlayerAnim>;
  private readonly sprite = this.sibling(AnimatedSpriteComponent);
  private readonly transform = this.sibling(Transform);
  private readonly rb = this.sibling(RigidBodyComponent);
  private readonly pc = this.sibling(ProcessComponent);

  private grounded = false;
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private wasGrounded = false;
  facingRight = true;

  // Slots
  private shootCd!: ProcessSlot;
  private invincibility!: ProcessSlot;
  private stun!: ProcessSlot;
  private flash!: ProcessSlot;
  private squash!: ProcessSlot;

  private static readonly SPEED = 220;
  private static readonly JUMP_VELOCITY = 505;
  private static readonly COYOTE_MS = 100;
  private static readonly JUMP_BUFFER_MS = 120;
  private static readonly GROUND_RAY_DIST = 22;
  private static readonly WALL_RAY_DIST = 16;
  private static readonly SHOOT_COOLDOWN_MS = 200;
  private static readonly STUN_MS = 300;
  private static readonly KNOCKBACK_X = 200;
  private static readonly KNOCKBACK_Y = -180;

  onAdd(): void {
    // Slots
    this.shootCd = this.pc.slot({ duration: PlayerController.SHOOT_COOLDOWN_MS });
    this.invincibility = this.pc.slot({
      duration: 500,
      cleanup: () => {
        // Re-check: still touching an enemy?
        const collider = this.entity.get(ColliderComponent);
        const enemies = collider.getOverlapping({ tags: ["enemy"] });
        if (enemies[0]) {
          this.tryDamageFrom(enemies[0]);
        }
      },
    });
    this.stun = this.pc.slot({ duration: PlayerController.STUN_MS });
    this.flash = this.pc.slot({
      duration: 100,
      cleanup: () => { this.sprite.animatedSprite.tint = 0xffffff; },
    });
    this.squash = this.pc.slot({
      cleanup: () => { this.transform.setScale(1, 1); },
    });

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

    // Handle contact damage from enemies
    const collider = this.entity.get(ColliderComponent);
    collider.onCollision((ev) => {
      if (ev.started && ev.other.tags.has("enemy")) {
        this.tryDamageFrom(ev.other);
      }
    });
  }

  update(dt: number): void {
    if (won) {
      this.rb.setVelocity(Vec2.ZERO);
      this.anim.unlock();
      this.anim.play("idle");
      return;
    }

    if (!this.stun.completed) return;

    const vel = this.rb.getVelocity();
    const pos = this.transform.position;

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
        this.anim.playOneShot("land", { duration: 120 });
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
      this.anim.current === "shoot"
        ? PlayerController.SPEED * 0.15
        : PlayerController.SPEED;
    this.rb.setVelocityX(dx * speed);

    // -- Jump buffering --
    if (keys.has(" ")) {
      this.jumpBufferTimer = PlayerController.JUMP_BUFFER_MS;
      keys.delete(" ");
    } else {
      this.jumpBufferTimer -= dt;
    }

    // -- Jump execution --
    if (this.jumpBufferTimer > 0 && this.grounded) {
      this.rb.setVelocityY(-PlayerController.JUMP_VELOCITY);
      this.grounded = false;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;

      // Jump stretch
      this.startSquash(0.8, 1.2);
      this.audio.play(JumpSfx.path, { channel: "sfx" });
    }

    // -- Shooting --
    if ((keys.has("j") || keys.has("k")) && this.shootCd.completed) {
      keys.delete("j");
      keys.delete("k");
      this.shootCd.start();
      this.spawnBullet();
      this.anim.playOneShot("shoot", { duration: PlayerController.SHOOT_COOLDOWN_MS });
      this.audio.play(ShootSfx.path, { channel: "sfx" });
      this.camera.shake(2, 100, { decay: 0.8 });
    }

    // -- Animation state (when not locked by one-shot) --
    if (!this.anim.locked) {
      if (!onGround) {
        this.anim.play("jump");
      } else if (dx !== 0) {
        this.anim.play("walk");
      } else {
        this.anim.play("idle");
      }
    }

    // -- Visual flip for facing direction --
    const currentScale = this.transform.scale;
    const flipX = this.facingRight
      ? Math.abs(currentScale.x)
      : -Math.abs(currentScale.x);
    this.transform.setScale(flipX, currentScale.y);
  }

  private startSquash(scaleX: number, scaleY: number): void {
    this.transform.setScale(scaleX, scaleY);
    this.squash.restart({
      duration: 120,
      update: (_dt, elapsed) => {
        const t = Math.max(0, 1 - elapsed / 120);
        const sx = 1 + (scaleX - 1) * t;
        const sy = 1 + (scaleY - 1) * t;
        this.transform.setScale(sx, sy);
      },
    });
  }

  private takeDamage(knockDir: number): void {
    if (!this.invincibility.completed) return;

    this.audio.play(HurtSfx.path, { channel: "sfx" });

    // Knockback
    this.rb.setVelocity(
      new Vec2(
        knockDir * PlayerController.KNOCKBACK_X,
        PlayerController.KNOCKBACK_Y,
      ),
    );

    // Flash red (cleanup resets tint)
    this.sprite.animatedSprite.tint = 0xff4444;
    this.flash.restart();

    // Hurt animation + stun
    this.anim.playOneShot("hurt", { duration: PlayerController.STUN_MS });
    this.stun.restart();

    // Invincibility (lasts longer than stun; cleanup re-checks overlap)
    this.invincibility.restart();

    this.camera.shake(5, 200, { decay: 0.7 });
  }

  private tryDamageFrom(enemy: import("@yage/core").Entity): void {
    if (!this.invincibility.completed) return;
    const enemyX = enemy.get(Transform).position.x;
    const playerX = this.transform.position.x;
    const knockDir = playerX >= enemyX ? 1 : -1;
    this.takeDamage(knockDir);
  }

  private spawnBullet(): void {
    const scene = this.entity.scene;
    if (!scene) return;
    const pos = this.transform.position;
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

class EnemyController extends Component {
  private readonly physicsWorld = this.service(PhysicsWorldKey);
  private readonly camera = this.service(CameraKey);
  private readonly audio = this.service(AudioManagerKey);
  private readonly anim = this.sibling(AnimationController) as AnimationController<EnemyAnim>;
  private readonly sprite = this.sibling(AnimatedSpriteComponent);
  private readonly transform = this.sibling(Transform);
  private readonly rb = this.sibling(RigidBodyComponent);
  private readonly pc = this.sibling(ProcessComponent);

  private hp = 3;
  private patrolDir = 1;
  private patrolLeft: number;
  private patrolRight: number;

  private state: EnemyState = "patrol";
  private targetX = 0;
  private cooldownTimer = 0;
  private attackTimer = 0;

  // Slots
  private flashSlot!: ProcessSlot;
  private shakeSlot!: ProcessSlot;

  private static readonly SPEED = 60;
  private static readonly CHARGE_SPEED = 350;
  private static readonly DETECT_RANGE = 120;
  private static readonly DETECT_Y = 60;
  private static readonly REACT_DURATION = 200;
  private static readonly ATTACK_MAX_DURATION = 1000;
  private static readonly SLASH_FRAME_START = 4;
  private static readonly SLASH_FRAME_END = 9;
  private static readonly COOLDOWN_DURATION = 500;

  constructor(patrolLeft: number, patrolRight: number) {
    super();
    this.patrolLeft = patrolLeft;
    this.patrolRight = patrolRight;
  }

  onAdd(): void {
    // Slots
    this.flashSlot = this.pc.slot({
      duration: 80,
      cleanup: () => { this.sprite.animatedSprite.tint = 0xffffff; },
    });
    this.shakeSlot = this.pc.slot({
      duration: 150,
      update: () => {
        const s = this.sprite.animatedSprite;
        s.position.set(
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 4,
        );
      },
      cleanup: () => { this.sprite.animatedSprite.position.set(0, 0); },
    });

    // AnimationController auto-plays "idle"; switch to walk for patrol
    this.anim.play("walk");

    // React to damage events on this entity
    this.listen(this.entity, Hurt, ({ dir }) => this.takeDamage(dir));
  }

  update(dt: number): void {
    const pos = this.transform.position;

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

        this.rb.setVelocityX(this.patrolDir * EnemyController.SPEED);
        this.anim.play("walk");
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
        this.rb.setVelocityX(0);
        // Animation completion triggers transition to attack (set up in enterReact)
        break;

      case "attack": {
        this.attackTimer -= dt;
        if (this.attackTimer <= 0) {
          this.enterCooldown();
          break;
        }

        const inSlash = this.anim.inFrameRange(
          EnemyController.SLASH_FRAME_START,
          EnemyController.SLASH_FRAME_END,
        );

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
            this.rb.setVelocityX(0);
          } else {
            this.rb.setVelocityX(dir * EnemyController.CHARGE_SPEED);
          }
        } else {
          this.rb.setVelocityX(0);
        }
        break;
      }

      case "cooldown":
        this.rb.setVelocityX(0);
        this.cooldownTimer -= dt;
        if (this.cooldownTimer <= 0) {
          this.state = "patrol";
          this.anim.play("walk");
        }
        break;

      case "hit":
        // Movement handled by knockback; wait for anim to complete (via process)
        break;

      case "die":
        this.rb.setVelocityX(0);
        break;
    }
  }

  private enterReact(playerX: number): void {
    this.state = "react";
    this.targetX = playerX;

    // Face toward player
    const pos = this.transform.position;
    this.updateFacing(playerX > pos.x ? 1 : -1);

    this.anim.play("react");
    this.pc.cancel("state-transition");
    this.pc.run(
      Process.delay(EnemyController.REACT_DURATION, () => {
        if (this.state === "react") this.enterAttack();
      }),
      { tags: ["state-transition"] },
    );
  }

  private enterAttack(): void {
    const pos = this.transform.position;

    this.state = "attack";
    this.attackTimer = EnemyController.ATTACK_MAX_DURATION;

    this.updateFacing(this.targetX > pos.x ? 1 : -1);

    this.anim.play("attack");
  }

  private enterCooldown(): void {
    this.state = "cooldown";
    this.cooldownTimer = EnemyController.COOLDOWN_DURATION;
    this.rb.setVelocityX(0);
    this.anim.play("idle");
  }

  private updateFacing(dir: number): void {
    const scale = this.transform.scale;
    const flipX = dir >= 0 ? Math.abs(scale.x) : -Math.abs(scale.x);
    this.transform.setScale(flipX, scale.y);
  }

  private takeDamage(bulletDir: number): void {
    if (this.state === "die") return;

    this.hp--;
    this.audio.play(HurtSfx.path, { channel: "sfx" });

    // Knockback (light)
    const vel = this.rb.getVelocity();
    this.rb.setVelocity(new Vec2(bulletDir * 30, vel.y - 10));

    // Face toward the bullet
    this.updateFacing(-bulletDir);

    if (this.hp <= 0) {
      this.die();
      return;
    }

    // Enter hit state
    this.state = "hit";
    this.pc.cancel("state-transition");

    // Flash white (cleanup resets tint)
    this.flashSlot.restart();

    // Shake (cleanup resets position)
    this.shakeSlot.restart();

    // Play hit animation and return to patrol when done
    const hitDuration = Math.min(this.anim.calcDuration("hit"), 400);
    this.anim.playOneShot("hit", {
      duration: hitDuration,
      onComplete: () => {
        if (this.state === "hit") {
          this.state = "patrol";
        }
      },
    });

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

    this.pc.cancel(); // cancel all feedback processes

    const s = this.sprite.animatedSprite;
    s.tint = 0xffffff;
    s.position.set(0, 0);

    const pos = this.transform.position;
    if (this.entity.scene) {
      spawnEnemyDeathParticles(this.entity.scene, pos.x, pos.y, ENEMY_COLOR);
    }
    this.camera.shake(6, 250, { decay: 0.7 });

    // Play die animation, then destroy
    this.anim.forcePlay("die");
    const dieDuration = this.anim.calcDuration("die");
    this.pc.run(
      Process.delay(dieDuration, () => {
        this.entity.destroy();
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
  const spriteComp = entity.add(
    new AnimatedSpriteComponent({ textures: idleFrames, layer: "player" }),
  );
  spriteComp.animatedSprite.anchor.set(0.5, 0.5 - 3 / FRAME_SIZE);
  entity.add(
    new AnimationController<PlayerAnim>({
      idle: { frames: idleFrames, speed: 0.15 },
      walk: { frames: sliceSheet(PlayerWalkTex.path, FRAME_SIZE), speed: 0.2 },
      jump: { frames: sliceSheet(PlayerJumpTex.path, FRAME_SIZE), speed: 0.12, loop: false },
      land: { frames: sliceSheet(PlayerLandTex.path, FRAME_SIZE), speed: 0.5, loop: false },
      shoot: { frames: sliceSheet(PlayerShootTex.path, FRAME_SIZE), speed: 0.4, loop: false },
      hurt: { frames: sliceSheet(PlayerHurtTex.path, FRAME_SIZE), speed: 0.3, loop: false },
    }),
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
  entity.add(new AnimatedSpriteComponent({ textures: idleFrames, layer: "world" }));
  entity.add(
    new AnimationController<EnemyAnim>({
      idle: {
        frames: idleFrames,
        speed: 0.15,
        anchor: { x: ENEMY_BODY_CENTER_X / 24, y: 1 - ENEMY_HALF_H / 32 },
      },
      walk: {
        frames: sliceSheet(EnemyWalkTex.path, 22, 33),
        speed: 0.15,
        anchor: { x: ENEMY_BODY_CENTER_X / 22, y: 1 - ENEMY_HALF_H / 33 },
      },
      react: {
        frames: sliceSheet(EnemyReactTex.path, 22, 32),
        speed: 0.2,
        loop: false,
        anchor: { x: ENEMY_BODY_CENTER_X / 22, y: 1 - ENEMY_HALF_H / 32 },
      },
      attack: {
        frames: sliceSheet(EnemyAttackTex.path, 43, 37),
        speed: 0.3,
        loop: false,
        anchor: { x: ENEMY_BODY_CENTER_X / 43, y: 1 - ENEMY_HALF_H / 37 },
      },
      hit: {
        frames: sliceSheet(EnemyHitTex.path, 30, 32),
        speed: 0.25,
        loop: false,
        anchor: { x: ENEMY_BODY_CENTER_X / 30, y: 1 - ENEMY_HALF_H / 32 },
      },
      die: {
        frames: sliceSheet(EnemyDieTex.path, 33, 32),
        speed: 0.2,
        loop: false,
        anchor: { x: ENEMY_BODY_CENTER_X / 33, y: 1 - ENEMY_HALF_H / 32 },
      },
    }),
  );
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
    pc.run(
      Process.delay(1200, () => {
        entity.destroy();
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

  private readonly layerMgr = this.service(RenderLayerManagerKey);
  private readonly audio = this.service(AudioManagerKey);

  onEnter(): void {
    this.layerMgr.create("bg", -10);
    this.layerMgr.create("world", 0);
    this.layerMgr.create("bullets", 5);
    this.layerMgr.create("player", 10);

    setKills(0);
    won = false;
    winMsg.style.display = "none";

    // Background music
    this.audio.play(BgMusic.path, { channel: "music", loop: true });

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
await createGame({
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: 0x0f172a,
  renderer: { pixi: { roundPixels: true } },
  physics: { gravity: { x: 0, y: 980 } },
  audio: true,
  debug: true,
  scene: new ShooterScene(),
});
