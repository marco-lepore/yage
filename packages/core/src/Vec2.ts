/** Default epsilon for floating-point comparisons. */
const EPSILON = 1e-6;

/** Any object with x and y numeric properties. */
export interface Vec2Like {
  readonly x: number;
  readonly y: number;
}

/** Immutable 2D vector. All operations return new instances. */
export class Vec2 implements Vec2Like {
  /** The zero vector (0, 0). */
  static readonly ZERO = new Vec2(0, 0);
  /** The one vector (1, 1). */
  static readonly ONE = new Vec2(1, 1);
  /** Up direction (0, -1) — screen coordinates. */
  static readonly UP = new Vec2(0, -1);
  /** Down direction (0, 1) — screen coordinates. */
  static readonly DOWN = new Vec2(0, 1);
  /** Left direction (-1, 0). */
  static readonly LEFT = new Vec2(-1, 0);
  /** Right direction (1, 0). */
  static readonly RIGHT = new Vec2(1, 0);

  constructor(
    /** The x component. */
    public readonly x: number,
    /** The y component. */
    public readonly y: number,
  ) {}

  /** Add another vector. */
  add(other: Vec2Like): Vec2 {
    return new Vec2(this.x + other.x, this.y + other.y);
  }

  /** Subtract another vector. */
  sub(other: Vec2Like): Vec2 {
    return new Vec2(this.x - other.x, this.y - other.y);
  }

  /** Scale by a scalar. */
  scale(scalar: number): Vec2 {
    return new Vec2(this.x * scalar, this.y * scalar);
  }

  /** Component-wise multiply with another vector. */
  multiply(other: Vec2Like): Vec2 {
    return new Vec2(this.x * other.x, this.y * other.y);
  }

  /** Dot product with another vector. */
  dot(other: Vec2Like): number {
    return this.x * other.x + this.y * other.y;
  }

  /** Cross product (z-component of the 3D cross product). */
  cross(other: Vec2Like): number {
    return this.x * other.y - this.y * other.x;
  }

  /** Magnitude of this vector. */
  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  /** Squared magnitude (avoids sqrt). */
  lengthSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  /** Return a unit vector in the same direction. Returns ZERO for zero-length vectors. */
  normalize(): Vec2 {
    const len = this.length();
    if (len < EPSILON) return Vec2.ZERO;
    return new Vec2(this.x / len, this.y / len);
  }

  /** Euclidean distance to another vector. */
  distance(other: Vec2Like): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Squared distance to another vector (avoids sqrt). */
  distanceSq(other: Vec2Like): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    return dx * dx + dy * dy;
  }

  /** Linear interpolation toward another vector. */
  lerp(other: Vec2Like, t: number): Vec2 {
    return new Vec2(
      this.x + (other.x - this.x) * t,
      this.y + (other.y - this.y) * t,
    );
  }

  /** Angle of this vector in radians (atan2). */
  angle(): number {
    return Math.atan2(this.y, this.x);
  }

  /** Rotate this vector by radians. */
  rotate(radians: number): Vec2 {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return new Vec2(this.x * cos - this.y * sin, this.x * sin + this.y * cos);
  }

  /** Check equality with optional epsilon tolerance. */
  equals(other: Vec2Like, epsilon: number = EPSILON): boolean {
    return (
      Math.abs(this.x - other.x) < epsilon &&
      Math.abs(this.y - other.y) < epsilon
    );
  }

  /** String representation. */
  toString(): string {
    return `Vec2(${this.x}, ${this.y})`;
  }

  /** Create a unit vector from an angle in radians, optionally scaled. */
  static fromAngle(radians: number, length: number = 1): Vec2 {
    return new Vec2(Math.cos(radians) * length, Math.sin(radians) * length);
  }

  /** Euclidean distance between two vectors. */
  static distance(a: Vec2Like, b: Vec2Like): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Linear interpolation between two vectors. */
  static lerp(a: Vec2Like, b: Vec2Like, t: number): Vec2 {
    return new Vec2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  }

  /** Move current toward target by at most maxDelta without overshooting. */
  static moveTowards(
    current: Vec2Like,
    target: Vec2Like,
    maxDelta: number,
  ): Vec2 {
    const dx = target.x - current.x;
    const dy = target.y - current.y;
    const distanceSq = dx * dx + dy * dy;

    if (distanceSq < EPSILON * EPSILON) {
      return new Vec2(target.x, target.y);
    }

    if (maxDelta <= 0) {
      return new Vec2(current.x, current.y);
    }

    const distance = Math.sqrt(distanceSq);
    if (distance <= maxDelta) {
      return new Vec2(target.x, target.y);
    }

    const scale = maxDelta / distance;
    return new Vec2(current.x + dx * scale, current.y + dy * scale);
  }
}
