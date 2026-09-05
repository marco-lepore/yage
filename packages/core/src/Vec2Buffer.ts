import type { Vec2Like } from "./Vec2.js";

/** Caller-owned scratch coordinates for vector operations and Into queries. */
export class Vec2Buffer implements Vec2Like {
  constructor(
    public x = 0,
    public y = 0,
  ) {}

  /** Replace both coordinates and return this buffer. */
  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }
}
