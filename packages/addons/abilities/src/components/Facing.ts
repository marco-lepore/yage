import { Component, Vec2 } from "@yagejs/core";

/** Four cardinal directions, Y-down screen convention (S = +y). */
export type Cardinal = "E" | "W" | "N" | "S";

/**
 * The entity's facing: a unit vector (source of truth) plus a derived angle
 * and 4-way cardinal for sprite-variant selection. Delivery steps
 * (hitbox, projectile) read `unit` through `resolveAim` when a step omits
 * an explicit `aim`. Defaults to +x (east).
 */
export class Facing extends Component {
  private _unit = new Vec2(1, 0);

  /** Current facing as a unit vector. `(1, 0)` until first `set`. */
  get unit(): Vec2 {
    return this._unit;
  }

  /** Angle in radians; 0 = +x (east), π/2 = +y (south, screen convention). */
  get angleRad(): number {
    return Math.atan2(this._unit.y, this._unit.x);
  }

  /** 4-way discretization. Ties (|x| === |y|) resolve to the x axis. */
  get cardinal(): Cardinal {
    const { x, y } = this._unit;
    if (Math.abs(x) >= Math.abs(y)) return x >= 0 ? "E" : "W";
    return y >= 0 ? "S" : "N";
  }

  /** Point facing along a vector (normalized). Zero vectors are ignored. */
  set(dx: number, dy: number): void {
    const unit = new Vec2(dx, dy).normalize();
    if (unit === Vec2.ZERO) return;
    this._unit = unit;
  }
}
