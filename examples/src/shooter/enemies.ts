import {
  Entity,
  Component,
  Transform,
  Vec2,
  ProcessComponent,
  Process,
  RandomKey,
  defineStates,
  type ProcessSlot,
} from "@yagejs/core";
import {
  AnimatedSpriteComponent,
  AnimationController,
  type CameraEntity,
  type TextureHandle,
  type VisualTransformModifierHandle,
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
  EnemyIdleTex,
  EnemyWalkTex,
  EnemyReactTex,
  EnemyAttackTex,
  EnemyHitTex,
  EnemyDieTex,
  HurtSfx,
  ExplosionSfx,
  SPRITE_SCALE,
} from "./constants.js";

// ---------------------------------------------------------------------------
// EnemyController — state machine with animated sprites
// ---------------------------------------------------------------------------
type EnemyState = "patrol" | "react" | "attack" | "cooldown" | "hit" | "die";
type EnemyAnim = "idle" | "walk" | "react" | "attack" | "hit" | "die";

/** Every enemy sheet uses the same frame, so one anchor fits every animation. */
const ENEMY_FRAME_W = 48;
const ENEMY_FRAME_H = 40;
/** Pixel column of the body's center in every frame. */
const ENEMY_BODY_CENTER_X = 20;
/** Half the collider's size in sheet pixels. The feet sit on the frame's
 *  last row. */
const ENEMY_HALF_W = 7;
const ENEMY_HALF_H = 12;
const ENEMY_ANCHOR = {
  x: ENEMY_BODY_CENTER_X / ENEMY_FRAME_W,
  y: 1 - ENEMY_HALF_H / ENEMY_FRAME_H,
};

const enemySheet = (sheet: TextureHandle) => ({
  sheet,
  frameWidth: ENEMY_FRAME_W,
  frameHeight: ENEMY_FRAME_H,
});

class EnemyController extends Component {
  private physicsWorld!: PhysicsWorld;
  private readonly camera: CameraEntity;
  private readonly audio = this.service(AudioManagerKey);
  private readonly random = this.service(RandomKey);
  private readonly anim = this.sibling(
    AnimationController,
  ) as AnimationController<EnemyAnim>;
  private readonly sprite = this.sibling(AnimatedSpriteComponent);
  private readonly transform = this.sibling(Transform);
  private readonly rb = this.sibling(RigidBodyComponent);
  private readonly collider = this.sibling(ColliderComponent);
  private readonly pc = this.sibling(ProcessComponent);

  private hp = 3;
  private patrolDir = 1;
  private patrolLeft: number;
  private patrolRight: number;

  private static readonly SPEED = 60;
  private static readonly CHARGE_SPEED = 350;
  private static readonly DETECT_RANGE = 120;
  private static readonly DETECT_Y = 60;
  private static readonly REACT_DURATION = 0.2;
  private static readonly ATTACK_MAX_DURATION = 1;
  private static readonly SLASH_FRAME_START = 4;
  private static readonly SLASH_FRAME_END = 9;
  private static readonly COOLDOWN_DURATION = 0.5;
  /** Turn or stop this far from a wall, in world pixels from the body's
   *  center. */
  private static readonly WALL_RAY_DIST = ENEMY_HALF_W * SPRITE_SCALE + 7;

  private readonly brain = this.stateMachine(
    defineStates<EnemyState>({
      patrol: {
        to: ["react"],
        enter: () => this.anim.play("walk"),
      },
      react: {
        to: ["attack"],
        for: EnemyController.REACT_DURATION,
        next: "attack",
        enter: () => {
          const pos = this.transform.position;
          this.updateFacing(this.targetX > pos.x ? 1 : -1);
          this.anim.play("react");
        },
      },
      attack: {
        to: ["cooldown"],
        for: EnemyController.ATTACK_MAX_DURATION,
        next: "cooldown",
        enter: () => {
          const pos = this.transform.position;
          this.updateFacing(this.targetX > pos.x ? 1 : -1);
          this.anim.play("attack");
        },
      },
      cooldown: {
        to: ["patrol"],
        for: EnemyController.COOLDOWN_DURATION,
        next: "patrol",
        enter: () => {
          this.rb.setVelocityX(0);
          this.anim.play("idle");
        },
      },
      // Reachable from every state, so no other state lists them.
      hit: { fromAny: true, to: ["patrol"] },
      die: { fromAny: true },
    }),
    "patrol",
  );
  private targetX = 0;
  // Cached once found; the player entity is never destroyed in this demo.
  private player?: Entity;

  // Slots
  private shakeSlot!: ProcessSlot;
  /** The sprite's shake offset. It moves only the drawing, not the body. */
  private shakeOffset!: VisualTransformModifierHandle;

  constructor(patrolLeft: number, patrolRight: number, camera: CameraEntity) {
    super();
    this.patrolLeft = patrolLeft;
    this.patrolRight = patrolRight;
    this.camera = camera;
  }

  onAdd(): void {
    this.physicsWorld = this.use(PhysicsWorldKey);

    // Slots
    this.shakeOffset = this.sprite.modifiers.addTransform();
    this.addCleanup(() => this.shakeOffset.remove());
    this.shakeSlot = this.pc.slot({
      duration: 0.15,
      update: () => {
        this.shakeOffset.setPosition({
          x: this.random.range(-2, 2),
          y: this.random.range(-2, 2),
        });
      },
      cleanup: () => {
        this.shakeOffset.setPosition(Vec2.ZERO);
      },
    });

    this.brain.start();

    // React to damage events on this entity
    this.listen(this.entity, Hurt, ({ dir }) => this.takeDamage(dir));
  }

  update(dt: number): void {
    this.brain.tick(dt);
    const pos = this.transform.position;

    switch (this.brain.state) {
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
        const wallHit = this.physicsWorld.raycast(
          pos,
          wallDir,
          EnemyController.WALL_RAY_DIST,
          {
            filterGroups,
          },
        );
        if (wallHit) this.patrolDir *= -1;

        this.rb.setVelocityX(this.patrolDir * EnemyController.SPEED);
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
        break;

      case "attack": {
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
          const wallHit = this.physicsWorld.raycast(
            pos,
            wallDir,
            EnemyController.WALL_RAY_DIST,
            {
              filterGroups,
            },
          );
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
    this.targetX = playerX;
    this.brain.go("react");
  }

  private updateFacing(dir: number): void {
    const scale = this.transform.scale;
    const flipX = dir >= 0 ? Math.abs(scale.x) : -Math.abs(scale.x);
    this.transform.setScale(flipX, scale.y);
  }

  private takeDamage(bulletDir: number): void {
    if (this.brain.is("die")) return;

    this.hp--;
    this.audio.play(HurtSfx, { channel: "sfx" });

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
    this.brain.go("hit");

    // Shake (cleanup resets the offset)
    this.shakeSlot.restart();

    // Play hit animation and return to patrol when done
    const hitDuration = Math.min(this.anim.calcDuration("hit"), 0.4);
    this.anim.playOneShot("hit", {
      duration: hitDuration,
      onComplete: () => {
        if (this.brain.is("hit")) {
          this.brain.go("patrol");
        }
      },
    });

    // Camera shake
    this.camera.shake(4, 0.15, { decay: 0.8 });
  }

  private die(): void {
    this.brain.go("die");
    this.audio.play(ExplosionSfx, { channel: "sfx" });

    // Stop blocking bullets and hurting the player. A sensor does not rest
    // on the floor either, so the body turns static to keep the corpse where
    // it fell while the death animation plays.
    this.entity.tags.delete("enemy");
    this.entity.tags.add("dead");
    this.collider.setSensor(true);
    this.rb.setType("static");

    this.pc.cancel(); // cancel all feedback processes; the shake resets

    this.camera.shake(6, 0.25, { decay: 0.7 });

    // Play die animation, then destroy
    this.anim.forcePlay("die");
    const dieDuration = this.anim.calcDuration("die");
    this.pc.run(
      Process.delay(dieDuration, () => {
        this.entity.destroy();
      }),
    );

    // Bubbles to the scene: the HUD counts the kill and the sparks entity
    // bursts at the enemy's position.
    const { x, y } = this.transform.position;
    this.entity.emit(EnemyKilled, { x, y });
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
    this.add(
      new Transform({
        position: new Vec2(x, y),
        scale: { x: SPRITE_SCALE, y: SPRITE_SCALE },
      }),
    );
    const idleSource = enemySheet(EnemyIdleTex);
    this.add(
      new AnimatedSpriteComponent({
        source: idleSource,
        anchor: ENEMY_ANCHOR,
        layer: "world",
      }),
    );
    this.add(
      new AnimationController<EnemyAnim>({
        idle: { source: idleSource, speed: 0.15 },
        walk: { source: enemySheet(EnemyWalkTex), speed: 0.15 },
        react: { source: enemySheet(EnemyReactTex), speed: 0.2, loop: false },
        attack: {
          source: enemySheet(EnemyAttackTex),
          speed: 0.3,
          loop: false,
        },
        hit: { source: enemySheet(EnemyHitTex), speed: 0.25, loop: false },
        die: { source: enemySheet(EnemyDieTex), speed: 0.2, loop: false },
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
        shape: {
          type: "box",
          width: ENEMY_HALF_W * 2,
          height: ENEMY_HALF_H * 2,
        },
        friction: 0,
        layers: LAYER_ENEMY,
        mask: LAYER_PLATFORM | LAYER_PLAYER | LAYER_BULLET,
      }),
    );
    this.add(new ProcessComponent());
    this.add(new EnemyController(patrolLeft, patrolRight, camera));
  }
}
