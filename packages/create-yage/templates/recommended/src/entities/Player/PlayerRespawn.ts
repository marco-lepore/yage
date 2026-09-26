import { Component, Transform, Vec2 } from "@yagejs/core";
import type { CameraEntity } from "@yagejs/renderer";
import { AudioManagerKey } from "@yagejs/audio";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import { hurtSfx } from "../../assets";
import { PlayerHit } from "../../events";
import { Hostile } from "../../traits";

export interface PlayerRespawnOptions {
  /** The camera following the player, cut back to the start on a respawn. */
  camera: CameraEntity;
  /** Where the player goes back to. */
  spawnPoint: Vec2;
}

/**
 * Sends the player back to the start when anything `Hostile` touches it, then
 * emits `PlayerHit` so the rest of the level can react.
 */
export class PlayerRespawn extends Component {
  private readonly audio = this.service(AudioManagerKey);
  private readonly transform = this.sibling(Transform);
  private readonly body = this.sibling(RigidBodyComponent);
  private readonly collider = this.sibling(ColliderComponent);
  private readonly camera: CameraEntity;
  private readonly spawnPoint: Vec2;

  constructor(options: PlayerRespawnOptions) {
    super();
    this.camera = options.camera;
    this.spawnPoint = options.spawnPoint;
  }

  onAdd(): void {
    // Any entity with @trait(Hostile) hurts the player: Hazard, Slime, or
    // your own.
    this.addCleanup(
      this.collider.onCollision((ev) => {
        if (ev.started && ev.other.hasTrait(Hostile)) this.respawn();
      }),
    );
  }

  private respawn(): void {
    const { x, y } = this.spawnPoint;
    this.audio.play(hurtSfx, { channel: "sfx" });
    this.body.setVelocity(Vec2.ZERO);
    this.body.setPosition(x, y);
    this.transform.setPosition(x, y);
    // Cut back to the start. Without this the camera would ease all the way
    // across the level at its `smoothing`, showing the trip back.
    this.camera.snapToTarget();
    // Each slime listens for this and returns to where it started.
    this.entity.emit(PlayerHit);
  }
}
