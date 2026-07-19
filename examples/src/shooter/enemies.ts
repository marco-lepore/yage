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
import {
  LAYER_PLAYER,
  LAYER_PLATFORM,
  LAYER_BULLET,
  LAYER_ENEMY,
  Hurt,
  EnemyKilled,
} from "./constants.js";
import {
  EnemyIdleTex,
  EnemyWalkTex,
  EnemyReactTex,
  EnemyAttackTex,
  EnemyHitTex,
  EnemyDieTex,
  HurtSfx,
  ExplosionSfx,
} from "./assets.js";
import { spawnEnemyDeathParticles } from "./particles.js";

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
  private physicsWorld!: PhysicsWorld;
  private readonly camera: CameraEntity;
  private readonly audio = this.service(AudioManagerKey);
  private readonly anim = this.sibling(AnimationController) as AnimationController<EnemyAnim>;
  private readonly sprite = this.sibling(AnimatedSpriteComponent);
  private readonly transform = this.sibling(Transform);
  private readonly rb = this.sibling(RigidBodyComponent);
  private readonly collider = this.sibling(ColliderComponent);
  private readonly pc = this.sibling(ProcessComponent);

  private hp = 3;
  private patrolDir = 1;
  private patrolLeft: number;
  private patrolRight: number;

  private state: EnemyState = "patrol";
  private targetX = 0;
  private cooldownTimer = 0;
  private attackTimer = 0;
  // Cached once found; the player entity is never destroyed in this demo.
  private player?: Entity;

  // Slots
  private flashSlot!: ProcessSlot;
  private shakeSlot!: ProcessSlot;

  private static readonly SPEED = 60;
  private static readonly CHARGE_SPEED = 350;
  private static readonly DETECT_RANGE = 120;
  private static readonly DETECT_Y = 60;
  private static readonly REACT_DURATION = 0.2;
  private static readonly ATTACK_MAX_DURATION = 1;
  private static readonly SLASH_FRAME_START = 4;
  private static readonly SLASH_FRAME_END = 9;
  private static readonly COOLDOWN_DURATION = 0.5;

  constructor(patrolLeft: number, patrolRight: number, camera: CameraEntity) {
    super();
    this.patrolLeft = patrolLeft;
    this.patrolRight = patrolRight;
    this.camera = camera;
  }

  onAdd(): void {
    this.physicsWorld = this.use(PhysicsWorldKey);

    // Slots
    this.flashSlot = this.pc.slot({
      duration: 0.08,
      cleanup: () => { this.sprite.animatedSprite.tint = 0xffffff; },
    });
    this.shakeSlot = this.pc.slot({
      duration: 0.15,
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

        // Detect player (resolved once, then cached)
        if (!this.player) {
          const found = this.scene.findEntitiesByTag("player")[0];
          if (found) this.player = found;
        }
        const player = this.player;
        if (player) {
          const playerPos = player.get(Transform).position;
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
    const hitDuration = Math.min(this.anim.calcDuration("hit"), 0.4);
    this.anim.playOneShot("hit", {
      duration: hitDuration,
      onComplete: () => {
        if (this.state === "hit") {
          this.state = "patrol";
        }
      },
    });

    // Camera shake
    this.camera.shake(4, 0.15, { decay: 0.8 });
  }

  private die(): void {
    this.state = "die";
    this.audio.play(ExplosionSfx.path, { channel: "sfx" });

    // Stop blocking bullets and hurting the player
    this.entity.tags.delete("enemy");
    this.entity.tags.add("dead");
    this.collider.setSensor(true);

    this.pc.cancel(); // cancel all feedback processes

    const s = this.sprite.animatedSprite;
    s.tint = 0xffffff;
    s.position.set(0, 0);

    const pos = this.transform.position;
    const scene = this.entity.tryScene;
    if (scene) {
      spawnEnemyDeathParticles(scene, pos.x, pos.y, ENEMY_COLOR);
    }
    this.camera.shake(6, 0.25, { decay: 0.7 });

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

export class EnemyEntity extends Entity {
  setup(params: {
    x: number;
    y: number;
    patrolLeft: number;
    patrolRight: number;
    camera: CameraEntity;
  }): void {
    const { x, y, patrolLeft, patrolRight, camera } = params;
    this.tags.add("enemy");
    this.add(new Transform({ position: new Vec2(x, y) }));
    const idleSource = { sheet: EnemyIdleTex.path, frameWidth: 24, frameHeight: 32 };
    this.add(new AnimatedSpriteComponent({ source: idleSource, layer: "world" }));
    this.add(
      new AnimationController<EnemyAnim>({
        idle: {
          source: idleSource,
          speed: 0.15,
          anchor: { x: ENEMY_BODY_CENTER_X / 24, y: 1 - ENEMY_HALF_H / 32 },
        },
        walk: {
          source: { sheet: EnemyWalkTex.path, frameWidth: 22, frameHeight: 33 },
          speed: 0.15,
          anchor: { x: ENEMY_BODY_CENTER_X / 22, y: 1 - ENEMY_HALF_H / 33 },
        },
        react: {
          source: { sheet: EnemyReactTex.path, frameWidth: 22, frameHeight: 32 },
          speed: 0.2,
          loop: false,
          anchor: { x: ENEMY_BODY_CENTER_X / 22, y: 1 - ENEMY_HALF_H / 32 },
        },
        attack: {
          source: { sheet: EnemyAttackTex.path, frameWidth: 43, frameHeight: 37 },
          speed: 0.3,
          loop: false,
          anchor: { x: ENEMY_BODY_CENTER_X / 43, y: 1 - ENEMY_HALF_H / 37 },
        },
        hit: {
          source: { sheet: EnemyHitTex.path, frameWidth: 30, frameHeight: 32 },
          speed: 0.25,
          loop: false,
          anchor: { x: ENEMY_BODY_CENTER_X / 30, y: 1 - ENEMY_HALF_H / 32 },
        },
        die: {
          source: { sheet: EnemyDieTex.path, frameWidth: 33, frameHeight: 32 },
          speed: 0.2,
          loop: false,
          anchor: { x: ENEMY_BODY_CENTER_X / 33, y: 1 - ENEMY_HALF_H / 32 },
        },
      }),
    );
    this.add(
      new RigidBodyComponent({
        type: "dynamic",
        fixedRotation: true,
      }),
    );
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: 22, height: 32 },
        friction: 0,
        layers: LAYER_ENEMY,
        mask: LAYER_PLATFORM | LAYER_PLAYER | LAYER_BULLET,
      }),
    );
    this.add(new ProcessComponent());
    this.add(new EnemyController(patrolLeft, patrolRight, camera));
  }
}
