import { Component, Transform, Vec2 } from "@yagejs/core";
import { AnimationController } from "@yagejs/renderer";
import { AudioManagerKey } from "@yagejs/audio";
import { InputManagerKey } from "@yagejs/input";
import {
  CollisionLayers,
  PhysicsWorldManagerKey,
  RigidBodyComponent,
  type PhysicsWorld,
} from "@yagejs/physics";
import { jumpSfx } from "../../scenes/GameScene";
import type { PlayerAnim } from "./index";
import { LAYER_PLAYER, LAYER_PLATFORM } from "../../layers";

const playerPlatformFilter = CollisionLayers.interactionGroups(
  LAYER_PLAYER,
  LAYER_PLATFORM,
);

/** Reads input and drives the player's RigidBody + animations. */
export class PlayerController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly audio = this.service(AudioManagerKey);
  private readonly transform = this.sibling(Transform);
  private readonly body = this.sibling(RigidBodyComponent);
  private readonly anim = this.sibling(
    AnimationController,
  ) as AnimationController<PlayerAnim>;
  private physicsWorld!: PhysicsWorld;

  private facingRight = true;

  private static readonly MOVE_SPEED = 240;
  private static readonly JUMP_VELOCITY = 520;
  private static readonly GROUND_RAY_DISTANCE = 22;

  onAdd(): void {
    this.physicsWorld = this.use(PhysicsWorldManagerKey).getOrCreateWorld(
      this.scene,
    );
  }

  update(): void {
    const velocity = this.body.getVelocity();
    const horizontal = this.input.getAxis("left", "right");
    const grounded = this.isGrounded();

    // Horizontal movement
    this.body.setVelocity(
      new Vec2(horizontal * PlayerController.MOVE_SPEED, velocity.y),
    );

    // Facing direction
    if (horizontal > 0) this.facingRight = true;
    else if (horizontal < 0) this.facingRight = false;

    const scale = this.transform.scale;
    const flipX = this.facingRight ? Math.abs(scale.x) : -Math.abs(scale.x);
    this.transform.setScale(flipX, scale.y);

    // Jump
    if (grounded && this.input.isJustPressed("jump")) {
      this.body.setVelocityY(-PlayerController.JUMP_VELOCITY);
      this.audio.play(jumpSfx.path, { channel: "sfx" });
    }

    // Animation state
    if (!grounded) {
      this.anim.play("jump");
    } else if (horizontal !== 0) {
      this.anim.play("walk");
    } else {
      this.anim.play("idle");
    }
  }

  private isGrounded(): boolean {
    const hit = this.physicsWorld.raycast(
      this.transform.position,
      Vec2.DOWN,
      PlayerController.GROUND_RAY_DISTANCE,
      { filterGroups: playerPlatformFilter },
    );
    return hit !== null;
  }
}
