import { Component } from "./Component.js";
import { devWarn } from "./internal/dev.js";
import { Vec2 } from "./Vec2.js";
import type { Vec2Like } from "./Vec2.js";

/** Mutable transform component for entity positioning. */
export class Transform extends Component {
  // Private backing fields
  private _position: Vec2;
  private _rotation: number;
  private _scale: Vec2;
  private _worldPosition: Vec2;
  private _worldRotation: number;
  private _worldScale: Vec2;
  // Once per instance: physics and camera-follow systems assign
  // `worldPosition` every frame, so a warning without this guard repeats on
  // every write while an ancestor's scale stays zero.
  private _warnedZeroScaleAxis = false;
  // Start dirty so the first `worldPosition` (or rotation/scale) read recomputes
  // against the parent chain, whatever it is. If we cached local-as-world up
  // front and `addChild` runs AFTER the read (rare but legal — e.g. a debug
  // probe that touches `worldPosition` before parenting completes), we'd serve
  // the stale init value forever. `addChild` still calls `_markDirty()`, which
  // becomes a no-op here but is the right marker for later mutations.
  private _dirty = true;

  constructor(options?: {
    position?: Vec2Like;
    rotation?: number;
    scale?: Vec2Like;
  }) {
    super();
    this._position = options?.position
      ? new Vec2(options.position.x, options.position.y)
      : Vec2.ZERO;
    this._rotation = options?.rotation ?? 0;
    this._scale = options?.scale
      ? new Vec2(options.scale.x, options.scale.y)
      : Vec2.ONE;
    // Seed world fields with local values so strict initialization is happy.
    // These are overwritten on the next read via _recompute().
    this._worldPosition = this._position;
    this._worldRotation = this._rotation;
    this._worldScale = this._scale;
  }

  /** Local position (relative to parent, or world if no parent). */
  get position(): Vec2 {
    return this._position;
  }

  set position(v: Vec2) {
    this._position = v;
    this._markDirty();
  }

  /** Local rotation in radians. */
  get rotation(): number {
    return this._rotation;
  }

  set rotation(v: number) {
    this._rotation = v;
    this._markDirty();
  }

  /** Local scale factor. */
  get scale(): Vec2 {
    return this._scale;
  }

  set scale(v: Vec2) {
    this._scale = v;
    this._markDirty();
  }

  /** Computed world position. Recomputed lazily when dirty. */
  get worldPosition(): Vec2 {
    if (this._dirty) this._recompute();
    return this._worldPosition;
  }

  /**
   * Set position in world space. Back-computes the local position from the
   * parent chain. On an axis where the parent's world scale is 0 no local
   * value can reach the requested world value, so the local value on that
   * axis is kept unchanged (and a dev-mode warning is emitted).
   */
  set worldPosition(v: Vec2) {
    const pt = this.entity?.parent?.tryGet(Transform);
    if (!pt) {
      this._position = v;
    } else {
      const delta = v.sub(pt.worldPosition).rotate(-pt.worldRotation);
      const ps = pt.worldScale;
      if ((ps.x === 0 || ps.y === 0) && !this._warnedZeroScaleAxis) {
        this._warnedZeroScaleAxis = true;
        const axes = [ps.x === 0 ? "x" : "", ps.y === 0 ? "y" : ""]
          .filter(Boolean)
          .join(", ");
        devWarn(
          `worldPosition on "${this.entity?.name ?? "?"}": the parent's world scale ` +
            `is 0 on ${axes} — the assignment cannot be honoured on that axis, so ` +
            `the local value there is kept unchanged.`,
        );
      }
      this._position = new Vec2(
        ps.x === 0 ? this._position.x : delta.x / ps.x,
        ps.y === 0 ? this._position.y : delta.y / ps.y,
      );
    }
    this._markDirty();
  }

  /** Computed world rotation. Recomputed lazily when dirty. */
  get worldRotation(): number {
    if (this._dirty) this._recompute();
    return this._worldRotation;
  }

  /** Set rotation in world space. Back-computes the local rotation from the parent chain. */
  set worldRotation(v: number) {
    const pt = this.entity?.parent?.tryGet(Transform);
    if (!pt) {
      this._rotation = v;
    } else {
      this._rotation = v - pt.worldRotation;
    }
    this._markDirty();
  }

  /** Computed world scale. Recomputed lazily when dirty. */
  get worldScale(): Vec2 {
    if (this._dirty) this._recompute();
    return this._worldScale;
  }

  /** Set position directly. */
  setPosition(x: number, y: number): void {
    this._position = new Vec2(x, y);
    this._markDirty();
  }

  /** Translate by an offset. */
  translate(dx: number, dy: number): void {
    this._position = new Vec2(this._position.x + dx, this._position.y + dy);
    this._markDirty();
  }

  /** Set rotation in radians. */
  setRotation(radians: number): void {
    this._rotation = radians;
    this._markDirty();
  }

  /** Rotate by a delta in radians. */
  rotate(deltaRadians: number): void {
    this._rotation += deltaRadians;
    this._markDirty();
  }

  /** Set scale. */
  setScale(x: number, y: number): void {
    this._scale = new Vec2(x, y);
    this._markDirty();
  }

  /**
   * Mark this transform and all descendant transforms as dirty.
   * @internal
   */
  _markDirty(): void {
    if (this._dirty) return;
    this._dirty = true;
    for (const child of this.entity?.children.values() ?? []) {
      child.tryGet(Transform)?._markDirty();
    }
  }

  private _recompute(): void {
    this._dirty = false;
    const pt = this.entity?.parent?.tryGet(Transform);
    if (!pt) {
      // Root or no parent: world = local
      this._worldPosition = this._position;
      this._worldRotation = this._rotation;
      this._worldScale = this._scale;
      return;
    }
    // Compose with parent world (triggers parent recompute if needed)
    const rotatedLocal = this._position
      .multiply(pt.worldScale)
      .rotate(pt.worldRotation);
    this._worldPosition = pt.worldPosition.add(rotatedLocal);
    this._worldRotation = pt.worldRotation + this._rotation;
    this._worldScale = pt.worldScale.multiply(this._scale);
  }
}
