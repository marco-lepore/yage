import { Component, Vec2, serializable } from "@yagejs/core";
import type { CameraShakeOptions } from "./CameraComponent.js";

export interface CameraShakeData {
  intensity: number;
  duration: number;
  elapsed: number;
  decay: number;
  offset: { x: number; y: number };
}

/**
 * Camera shake behavior. Produces a `shakeOffset` that
 * `CameraComponent.effectivePosition` reads each frame.
 * Does NOT modify `CameraComponent.position` directly.
 */
@serializable
export class CameraShake extends Component {
  private intensity = 0;
  private duration = 0;
  private elapsed = 0;
  private decay = 0;

  /** Current shake offset (read by CameraComponent.effectivePosition). */
  offset: Vec2 = Vec2.ZERO;

  /** Start a screen shake effect. */
  start(
    intensity: number,
    duration: number,
    options?: CameraShakeOptions,
  ): void {
    this.intensity = intensity;
    this.duration = duration;
    this.elapsed = 0;
    this.decay = options?.decay ?? 0;
    this.offset = Vec2.ZERO;
  }

  /** Cancel the current shake immediately. */
  stop(): void {
    this.offset = Vec2.ZERO;
    this.duration = 0;
    this.intensity = 0;
    this.elapsed = 0;
    this.decay = 0;
  }

  update(dt: number): void {
    if (this.duration <= 0) return;

    this.elapsed += dt;
    if (this.elapsed >= this.duration) {
      this.stop();
      return;
    }

    let currentIntensity = this.intensity;
    if (this.decay > 0) {
      const progress = this.elapsed / this.duration;
      currentIntensity = Math.max(
        0,
        this.intensity * (1 - progress * this.decay),
      );
    }

    const phase = this.elapsed * 0.1;
    this.offset = new Vec2(
      Math.sin(phase * 7.3) * currentIntensity,
      Math.cos(phase * 13.7) * currentIntensity,
    );
  }

  serialize(): CameraShakeData {
    return {
      intensity: this.intensity,
      duration: this.duration,
      elapsed: this.elapsed,
      decay: this.decay,
      offset: { x: this.offset.x, y: this.offset.y },
    };
  }

  static fromSnapshot(data: CameraShakeData): CameraShake {
    const shake = new CameraShake();
    shake.intensity = data.intensity;
    shake.duration = data.duration;
    shake.elapsed = data.elapsed;
    shake.decay = data.decay;
    shake.offset = new Vec2(data.offset.x, data.offset.y);
    return shake;
  }
}
