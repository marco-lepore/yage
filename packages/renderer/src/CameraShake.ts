import { Component, Vec2 } from "@yagejs/core";
import type { CameraShakeOptions } from "./CameraComponent.js";
import { CameraComponent } from "./CameraComponent.js";
import type { CameraModifierHandle } from "./CameraModifiers.js";

/**
 * Camera shake behavior. Writes one removable contribution to
 * `CameraComponent.modifiers` and leaves the base position unchanged.
 */
export class CameraShake extends Component {
  private intensity = 0;
  private duration = 0;
  private elapsed = 0;
  private decay = 0;

  private _offset: Vec2 = Vec2.ZERO;
  private modifier: CameraModifierHandle | undefined;

  /** Current shake offset contributed through `CameraComponent.modifiers`. */
  get offset(): Vec2 {
    return this._offset;
  }

  /** Start a screen shake effect. */
  start(
    intensity: number,
    duration: number,
    options?: CameraShakeOptions,
  ): void {
    this.stop();
    this.intensity = intensity;
    this.duration = duration;
    this.elapsed = 0;
    this.decay = options?.decay ?? 0;
    if (duration > 0 && intensity !== 0) this.ensureModifier();
  }

  /** Cancel the current shake immediately. */
  stop(): void {
    this.setOffset(Vec2.ZERO);
    this.modifier?.remove();
    this.modifier = undefined;
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

    // `elapsed` is in seconds; the multiplier sets the oscillation frequency.
    const phase = this.elapsed * 100;
    this.setOffset(
      new Vec2(
        Math.sin(phase * 7.3) * currentIntensity,
        Math.cos(phase * 13.7) * currentIntensity,
      ),
    );
  }
  onDestroy(): void {
    this.modifier?.remove();
    this.modifier = undefined;
  }

  private setOffset(offset: Vec2): void {
    this._offset = offset;
    this.modifier?.setPosition(offset);
  }

  private ensureModifier(): void {
    this.modifier ??= this.sibling(CameraComponent).modifiers.add({
      position: this._offset,
    });
  }
}
