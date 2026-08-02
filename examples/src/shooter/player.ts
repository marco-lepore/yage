import {
  Entity,
  Component,
  Transform,
  Vec2,
  ProcessComponent,
  Process,
} from "@yagejs/core";
import type { ProcessSlot } from "@yagejs/core";
import {
  GraphicsComponent,
  AnimatedSpriteComponent,
  AnimationController,
  type CameraEntity,
} from "@yagejs/renderer";
import {
  RigidBodyComponent,
  ColliderComponent,
  CollisionLayers,
  PhysicsWorldKey,
} from "@yagejs/physics";
import type { PhysicsWorld } from "@yagejs/physics";
import { AudioManagerKey } from "@yagejs/audio";
import { InputManagerKey } from "@yagejs/input";
import {
  SPAWN,
  WORLD_W,
  WORLD_H,
  LAYER_PLAYER,
  LAYER_PLATFORM,
  LAYER_BULLET,
  LAYER_ENEMY,
  Hurt,
} from "./constants.js";
import {
  FRAME_SIZE,
  PlayerIdleTex,
  PlayerWalkTex,
  PlayerJumpTex,
  PlayerLandTex,
  PlayerShootTex,
  PlayerHurtTex,
  ShootSfx,
  HurtSfx,
  JumpSfx,
  LandSfx,
} from "./assets.js";
import { isWon } from "./ui.js";
import { spawnBulletImpactParticles, spawnEnemyHitParticles } from "./particles.js";

// ---------------------------------------------------------------------------
// PlayerController
// ---------------------------------------------------------------------------
type PlayerAnim = "idle" | "walk" | "jump" | "land" | "shoot" | "hurt";

class PlayerController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly camera: CameraEntity;
  private physicsWorld!: PhysicsWorld;
  private readonly audio = this.service(AudioManagerKey);
  private readonly anim = this.sibling(AnimationController) as AnimationController<PlayerAnim>;
  private readonly sprite = this.sibling(AnimatedSpriteComponent);
  private readonly transform = this.sibling(Transform);
  private readonly rb = this.sibling(RigidBodyComponent);
  private readonly collider = this.sibling(ColliderComponent);
  private readonly pc = this.sibling(ProcessComponent);

  constructor(camera: CameraEntity) {
    super();
    this.camera = camera;
  }

  private grounded = false;
  private coyoteTimer = 0;
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
  private static readonly COYOTE_SECONDS = 0.1;
  private static readonly JUMP_BUFFER_SECONDS = 0.12;
  private static readonly GROUND_RAY_DIST = 22;
  private static readonly WALL_RAY_DIST = 16;
  private static readonly SHOOT_COOLDOWN_SECONDS = 0.2;
  private static readonly STUN_SECONDS = 0.3;
  private static readonly KNOCKBACK_X = 200;
  private static readonly KNOCKBACK_Y = -180;

  onAdd(): void {
    this.physicsWorld = this.use(PhysicsWorldKey);

    // Slots
    this.shootCd = this.pc.slot({ duration: PlayerController.SHOOT_COOLDOWN_SECONDS });
    this.invincibility = this.pc.slot({
      duration: 0.5,
      cleanup: () => {
        // Re-check: still touching an enemy?
        const enemies = this.collider.getOverlapping({ tags: ["enemy"] });
        if (enemies[0]) {
          this.tryDamageFrom(enemies[0]);
        }
      },
    });
    this.stun = this.pc.slot({ duration: PlayerController.STUN_SECONDS });
    this.flash = this.pc.slot({
      duration: 0.1,
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
    this.collider.onCollision((ev) => {
      if (ev.started && ev.other.tags.has("enemy")) {
        this.tryDamageFrom(ev.other);
      }
    });
  }

  update(dt: number): void {
    if (isWon()) {
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
    // Raycasts don't consult contact filters, so during a drop-through the
    // ray still reports the one-way platform being fallen through. It isn't
    // supporting the player, so it must not restore grounded state (and
    // with it the ability to jump mid-drop). Solid ground still counts.
    const passingThroughHit =
      this.collider.isDroppingThrough &&
      hit?.entity.tryGet(ColliderComponent)?.config.oneWay !== undefined;
    const onGround = hit !== null && !passingThroughHit;

    if (onGround) {
      this.grounded = true;
      this.coyoteTimer = PlayerController.COYOTE_SECONDS;
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
        this.anim.playOneShot("land", { duration: 0.12 });
      }
      this.audio.play(LandSfx.path, { channel: "sfx" });
    }
    this.wasGrounded = onGround;

    // -- Drop through one-way platforms --
    if (
      this.input.isJustPressed("down") &&
      onGround &&
      hit?.entity.tryGet(ColliderComponent)?.config.oneWay
    ) {
      this.collider.dropThrough(0.25);
      this.grounded = false;
      this.coyoteTimer = 0;
    }

    // -- Horizontal movement --
    let dx = this.input.getAxis("left", "right");

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

    // -- Jump (buffered): a press within the window fires on the next grounded
    // frame; the input manager holds the buffer and claim-once prevents refire.
    if (
      this.grounded &&
      this.input.consumeBufferedPress("jump", PlayerController.JUMP_BUFFER_SECONDS)
    ) {
      this.rb.setVelocityY(-PlayerController.JUMP_VELOCITY);
      this.grounded = false;
      this.coyoteTimer = 0;

      // Jump stretch
      this.startSquash(0.8, 1.2);
      this.audio.play(JumpSfx.path, { channel: "sfx" });
    }

    // -- Shooting --
    if (this.input.isJustPressed("shoot") && this.shootCd.completed) {
      this.shootCd.start();
      this.spawnBullet();
      this.anim.playOneShot("shoot", { duration: PlayerController.SHOOT_COOLDOWN_SECONDS });
      this.audio.play(ShootSfx.path, { channel: "sfx" });
      this.camera.shake(2, 0.1, { decay: 0.8 });
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
      duration: 0.12,
      update: (_dt, elapsed) => {
        const t = Math.max(0, 1 - elapsed / 0.12);
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
    this.anim.playOneShot("hurt", { duration: PlayerController.STUN_SECONDS });
    this.stun.restart();

    // Invincibility (lasts longer than stun; cleanup re-checks overlap)
    this.invincibility.restart();

    this.camera.shake(5, 0.2, { decay: 0.7 });
  }

  private tryDamageFrom(enemy: Entity): void {
    if (!this.invincibility.completed) return;
    const enemyX = enemy.get(Transform).position.x;
    const playerX = this.transform.position.x;
    const knockDir = playerX >= enemyX ? 1 : -1;
    this.takeDamage(knockDir);
  }

  private spawnBullet(): void {
    const scene = this.scene;
    const pos = this.transform.position;
    const dir = this.facingRight ? 1 : -1;
    scene.spawn(BulletEntity, { x: pos.x + dir * 18, y: pos.y - 6, dir });
  }
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
export class PlayerEntity extends Entity {
  setup(params: { camera: CameraEntity }): void {
    this.tags.add("player");
    this.add(new Transform({ position: new Vec2(SPAWN.x, SPAWN.y) }));
    const idleSource = { sheet: PlayerIdleTex.path, frameWidth: FRAME_SIZE };
    const spriteComp = this.add(
      new AnimatedSpriteComponent({ source: idleSource, layer: "player" }),
    );
    spriteComp.animatedSprite.anchor.set(0.5, 0.5 - 3 / FRAME_SIZE);
    this.add(
      new AnimationController<PlayerAnim>({
        idle: { source: idleSource, speed: 0.15 },
        walk: { source: { sheet: PlayerWalkTex.path, frameWidth: FRAME_SIZE }, speed: 0.2 },
        jump: { source: { sheet: PlayerJumpTex.path, frameWidth: FRAME_SIZE }, speed: 0.12, loop: false },
        land: { source: { sheet: PlayerLandTex.path, frameWidth: FRAME_SIZE }, speed: 0.5, loop: false },
        shoot: { source: { sheet: PlayerShootTex.path, frameWidth: FRAME_SIZE }, speed: 0.4, loop: false },
        hurt: { source: { sheet: PlayerHurtTex.path, frameWidth: FRAME_SIZE }, speed: 0.3, loop: false },
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
        mask: LAYER_PLATFORM | LAYER_ENEMY,
      }),
    );
    this.add(new ProcessComponent());
    this.add(new PlayerController(params.camera));
  }
}

class BulletEntity extends Entity {
  setup(params: { x: number; y: number; dir: number }): void {
    const { x, y, dir } = params;
    this.tags.add("bullet");
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent({ layer: "bullets" }).draw((g) => {
        g.rect(-4, -2, 8, 4).fill({ color: 0x38bdf8 });
      }),
    );
    this.add(
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
    this.add(collider);

    // Self-destruct after 1.2s
    const pc = this.add(new ProcessComponent());
    pc.run(
      Process.delay(1.2, () => {
        this.destroy();
      }),
    );

    // Set bullet velocity after body is created
    this.get(RigidBodyComponent).setVelocity(new Vec2(dir * 600, 0));

    // Collision handler
    collider.onCollision((ev) => {
      const scene = this.tryScene;
      if (!ev.started || !scene) return;
      if (ev.other.tags.has("dead")) return; // ignore dying enemies
      const bPos = this.get(Transform).position;

      if (ev.other.tags.has("enemy")) {
        ev.other.emit(Hurt, { dir });
        spawnEnemyHitParticles(scene, bPos.x, bPos.y);
      } else {
        const normalAngle = dir > 0 ? Math.PI : 0;
        spawnBulletImpactParticles(scene, bPos.x, bPos.y, normalAngle);
      }
      this.destroy();
    });
  }
}
