import { Component, Vec2 } from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";
import { CameraComponent, CAMERA_REFERENCE_DT } from "./CameraComponent.js";
import type { CameraFollowOptions } from "./CameraComponent.js";

/**
 * Camera follow behavior. Smoothly moves `CameraComponent.position`
 * toward a target each frame. Add order matters: runs before
 * `CameraBoundsComponent` so bounds clamping happens after follow.
 */
export class CameraFollow extends Component {
  private readonly cam = this.sibling(CameraComponent);
  private target: { position: Vec2Like } | null = null;
  private smoothing = 1;
  private offset: Vec2 = Vec2.ZERO;
  private deadzone: { halfWidth: number; halfHeight: number } | null = null;

  /** Start following a target. */
  start(target: { position: Vec2Like }, options?: CameraFollowOptions): void {
    this.target = target;
    this.smoothing = options?.smoothing ?? 1;
    this.offset = options?.offset
      ? new Vec2(options.offset.x, options.offset.y)
      : Vec2.ZERO;
    this.deadzone = options?.deadzone ?? null;
    if (options?.snap) this.snapToTarget();
  }

  /** Stop following any target. */
  stop(): void {
    this.target = null;
    this.deadzone = null;
  }

  /**
   * Place the camera on its target right away, offset included. Skips both
   * the smoothing ease and the deadzone, so the camera cuts rather than
   * glides — use it after a teleport (room change, respawn). Any deadzone
   * applies again from the next frame. Does nothing without a target.
   */
  snapToTarget(): void {
    const targetPos = this.targetPosition();
    if (targetPos) this.cam.position = targetPos;
  }

  update(dt: number): void {
    const targetPos = this.targetPosition();
    if (!targetPos) return;

    if (this.deadzone) {
      const dx = targetPos.x - this.cam.position.x;
      const dy = targetPos.y - this.cam.position.y;
      const hw = this.deadzone.halfWidth;
      const hh = this.deadzone.halfHeight;

      let moveX = 0;
      let moveY = 0;
      if (dx > hw) moveX = dx - hw;
      else if (dx < -hw) moveX = dx + hw;
      if (dy > hh) moveY = dy - hh;
      else if (dy < -hh) moveY = dy + hh;

      if (moveX === 0 && moveY === 0) return;

      const destination = new Vec2(
        this.cam.position.x + moveX,
        this.cam.position.y + moveY,
      );
      const t = frameLerp(this.smoothing, dt);
      this.cam.position = this.cam.position.lerp(destination, t);
    } else {
      const t = frameLerp(this.smoothing, dt);
      this.cam.position = this.cam.position.lerp(targetPos, t);
    }
  }

  /** Current target position with the follow offset applied. */
  private targetPosition(): Vec2 | null {
    if (!this.target) return null;
    const pos = this.target.position;
    return new Vec2(pos.x + this.offset.x, pos.y + this.offset.y);
  }
}

function frameLerp(smoothing: number, dt: number): number {
  if (smoothing >= 1) return 1;
  return 1 - Math.pow(1 - smoothing, dt / CAMERA_REFERENCE_DT);
}
