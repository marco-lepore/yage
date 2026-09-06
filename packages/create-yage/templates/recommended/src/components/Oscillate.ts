import { Component, Transform, type Vec2 } from "@yagejs/core";

/**
 * Oscillates a kinematic entity along one axis on a sine wave, around the
 * position it holds on its first update.
 *
 * The first update is the earliest moment that position is the final one: a
 * level applies a placement's transform after `setup()` returns, so a position
 * read while the components are being added is the one the entity had before
 * it was placed.
 *
 * Used by `Coin` (vertical bob) and `Hazard` (horizontal slide).
 */
export interface OscillateOptions {
  /** Axis to move along. */
  axis: "x" | "y";
  /** Peak distance (pixels) from the origin. */
  amplitude: number;
  /** Period of one full oscillation (seconds). */
  period: number;
  /** Phase offset in radians. Useful to stagger multiple instances. Default 0. */
  phase?: number;
}

export class Oscillate extends Component {
  private readonly transform = this.sibling(Transform);
  private readonly axis: "x" | "y";
  private readonly amplitude: number;
  private readonly period: number;
  private readonly phase: number;

  private origin?: Vec2;
  private elapsed = 0;

  constructor(options: OscillateOptions) {
    super();
    this.axis = options.axis;
    this.amplitude = options.amplitude;
    this.period = options.period;
    this.phase = options.phase ?? 0;
  }

  update(dt: number): void {
    const origin = (this.origin ??= this.transform.position);
    this.elapsed += dt;
    const t = (this.elapsed * Math.PI * 2) / this.period + this.phase;
    const offset = Math.sin(t) * this.amplitude;
    if (this.axis === "x") {
      this.transform.setPosition(origin.x + offset, origin.y);
    } else {
      this.transform.setPosition(origin.x, origin.y + offset);
    }
  }
}
