import { Component, Transform } from "@yagejs/core";

/**
 * Oscillates a kinematic entity along one axis on a sine wave. Captures the
 * spawn position at `onAdd` and oscillates around it.
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

  private originX = 0;
  private originY = 0;
  private elapsed = 0;

  constructor(options: OscillateOptions) {
    super();
    this.axis = options.axis;
    this.amplitude = options.amplitude;
    this.period = options.period;
    this.phase = options.phase ?? 0;
  }

  onAdd(): void {
    const pos = this.transform.position;
    this.originX = pos.x;
    this.originY = pos.y;
  }

  update(dt: number): void {
    this.elapsed += dt / 1000;
    const t = (this.elapsed * Math.PI * 2) / this.period + this.phase;
    const offset = Math.sin(t) * this.amplitude;
    if (this.axis === "x") {
      this.transform.setPosition(this.originX + offset, this.originY);
    } else {
      this.transform.setPosition(this.originX, this.originY + offset);
    }
  }
}
