import { Component } from "./Component.js";
import { devWarn } from "./internal/dev.js";
import { Vec2 } from "./Vec2.js";
import type { Vec2Like } from "./Vec2.js";
import type { Vec2Buffer } from "./Vec2Buffer.js";

/** Mutable transform component for entity positioning. */
export class Transform extends Component {
  // Private backing fields
  private _position: Vec2 | undefined;
  private _positionX: number;
  private _positionY: number;
  private _rotation: number;
  private _scale: Vec2 | undefined;
  private _scaleX: number;
  private _scaleY: number;
  private _worldPosition: Vec2 | undefined;
  private _worldPositionX: number;
  private _worldPositionY: number;
  private _worldRotation: number;
  private _worldScale: Vec2 | undefined;
  private _worldScaleX: number;
  private _worldScaleY: number;
  private _worldIsLocal = true;
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
    if (options?.position) {
      this._finite(options.position.x, "constructor", "position.x");
      this._finite(options.position.y, "constructor", "position.y");
    }
    if (options?.scale) {
      this._finite(options.scale.x, "constructor", "scale.x");
      this._finite(options.scale.y, "constructor", "scale.y");
    }
    this._finite(options?.rotation ?? 0, "constructor", "rotation");
    this._position = options?.position
      ? new Vec2(options.position.x, options.position.y)
      : Vec2.ZERO;
    this._rotation = options?.rotation ?? 0;
    this._scale = options?.scale
      ? new Vec2(options.scale.x, options.scale.y)
      : Vec2.ONE;
    this._positionX = this._position.x;
    this._positionY = this._position.y;
    this._scaleX = this._scale.x;
    this._scaleY = this._scale.y;
    // Seed world fields with local values so strict initialization is happy.
    // These are overwritten on the next read via _recompute().
    this._worldPosition = this._position;
    this._worldRotation = this._rotation;
    this._worldScale = this._scale;
    this._worldPositionX = this._positionX;
    this._worldPositionY = this._positionY;
    this._worldScaleX = this._scaleX;
    this._worldScaleY = this._scaleY;
  }

  /** Local position (relative to parent, or world if no parent). */
  get position(): Vec2 {
    return (this._position ??= new Vec2(this._positionX, this._positionY));
  }

  set position(v: Vec2) {
    this._finite(v.x, "position", "x");
    this._finite(v.y, "position", "y");
    this._position = v;
    this._positionX = v.x;
    this._positionY = v.y;
    this._markDirty();
  }

  /** Local rotation in radians. */
  get rotation(): number {
    return this._rotation;
  }

  set rotation(v: number) {
    this._finite(v, "rotation", "rotation");
    this._rotation = v;
    this._markDirty();
  }

  /** Local scale factor. */
  get scale(): Vec2 {
    return (this._scale ??= new Vec2(this._scaleX, this._scaleY));
  }

  set scale(v: Vec2) {
    this._finite(v.x, "scale", "x");
    this._finite(v.y, "scale", "y");
    this._scale = v;
    this._scaleX = v.x;
    this._scaleY = v.y;
    this._markDirty();
  }

  /** Computed world position. Recomputed lazily when dirty. */
  get worldPosition(): Vec2 {
    if (this._dirty) this._recompute();
    if (this._worldIsLocal) return this.position;
    return (this._worldPosition ??= new Vec2(
      this._worldPositionX,
      this._worldPositionY,
    ));
  }

  /**
   * Set position in world space. Back-computes the local position from the
   * parent chain. On an axis where the parent's world scale is 0 no local
   * value can reach the requested world value, so the local value on that
   * axis is kept unchanged (and a dev-mode warning is emitted).
   */
  set worldPosition(v: Vec2) {
    this._setWorldPosition(v.x, v.y, "worldPosition", v);
  }

  /** Set world coordinates without constructing a vector. */
  setWorldPosition(x: number, y: number): void {
    this._setWorldPosition(x, y, "setWorldPosition");
  }

  private _setWorldPosition(
    worldX: number,
    worldY: number,
    method: string,
    snapshot?: Vec2,
  ): void {
    this._finite(worldX, method, "x");
    this._finite(worldY, method, "y");
    const pt = this.entity?.parent?.tryGet(Transform);
    if (!pt) {
      this._position = snapshot;
      this._positionX = worldX;
      this._positionY = worldY;
    } else {
      if (pt._dirty) pt._recompute();
      const dx = worldX - pt._worldPositionX;
      const dy = worldY - pt._worldPositionY;
      const cos = Math.cos(-pt._worldRotation);
      const sin = Math.sin(-pt._worldRotation);
      const sx = pt._worldScaleX;
      const sy = pt._worldScaleY;
      const x = sx === 0 ? this._positionX : (dx * cos - dy * sin) / sx;
      const y = sy === 0 ? this._positionY : (dx * sin + dy * cos) / sy;
      this._finite(x, method, "local x");
      this._finite(y, method, "local y");
      if ((sx === 0 || sy === 0) && !this._warnedZeroScaleAxis) {
        this._warnedZeroScaleAxis = true;
        const axes = [sx === 0 ? "x" : "", sy === 0 ? "y" : ""]
          .filter(Boolean)
          .join(", ");
        devWarn(
          `worldPosition on "${this.entity?.name ?? "?"}": the parent's world scale ` +
            `is 0 on ${axes} — the assignment cannot be honoured on that axis, so ` +
            `the local value there is kept unchanged.`,
        );
      }
      this._positionX = x;
      this._positionY = y;
      this._position = undefined;
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
    this._finite(v, "worldRotation", "rotation");
    const pt = this.entity?.parent?.tryGet(Transform);
    if (!pt) {
      this._rotation = v;
    } else {
      this._rotation = this._finite(
        v - pt.worldRotation,
        "worldRotation",
        "local rotation",
      );
    }
    this._markDirty();
  }

  /** Computed world scale. Recomputed lazily when dirty. */
  get worldScale(): Vec2 {
    if (this._dirty) this._recompute();
    if (this._worldIsLocal) return this.scale;
    return (this._worldScale ??= new Vec2(
      this._worldScaleX,
      this._worldScaleY,
    ));
  }

  /** Copy local coordinates into caller-owned scratch. */
  getPositionInto(out: Vec2Buffer): Vec2Buffer {
    return out.set(this._positionX, this._positionY);
  }

  /** Copy world coordinates into caller-owned scratch. */
  getWorldPositionInto(out: Vec2Buffer): Vec2Buffer {
    if (this._dirty) this._recompute();
    return out.set(this._worldPositionX, this._worldPositionY);
  }

  /** Copy local scale into caller-owned scratch. */
  getScaleInto(out: Vec2Buffer): Vec2Buffer {
    return out.set(this._scaleX, this._scaleY);
  }

  /** Copy composed world scale into caller-owned scratch. */
  getWorldScaleInto(out: Vec2Buffer): Vec2Buffer {
    if (this._dirty) this._recompute();
    return out.set(this._worldScaleX, this._worldScaleY);
  }

  /** Set position directly. */
  setPosition(x: number, y: number): void {
    this._finite(x, "setPosition", "x");
    this._finite(y, "setPosition", "y");
    this._positionX = x;
    this._positionY = y;
    this._position = undefined;
    this._markDirty();
  }

  /** Translate by an offset. */
  translate(dx: number, dy: number): void {
    this._finite(dx, "translate", "dx");
    this._finite(dy, "translate", "dy");
    const x = this._finite(this._positionX + dx, "translate", "x");
    const y = this._finite(this._positionY + dy, "translate", "y");
    this._positionX = x;
    this._positionY = y;
    this._position = undefined;
    this._markDirty();
  }

  /** Set rotation in radians. */
  setRotation(radians: number): void {
    this._finite(radians, "setRotation", "rotation");
    this._rotation = radians;
    this._markDirty();
  }

  /** Rotate by a delta in radians. */
  rotate(deltaRadians: number): void {
    this._finite(deltaRadians, "rotate", "deltaRadians");
    this._rotation = this._finite(
      this._rotation + deltaRadians,
      "rotate",
      "rotation",
    );
    this._markDirty();
  }

  /** Set scale. */
  setScale(x: number, y: number): void {
    this._finite(x, "setScale", "x");
    this._finite(y, "setScale", "y");
    this._scaleX = x;
    this._scaleY = y;
    this._scale = undefined;
    this._markDirty();
  }

  /**
   * Convert a world-space point into this entity's own local space — the
   * inverse of this transform's world position, rotation and scale. Use it to
   * ask where a world point falls inside an entity that is parented, rotated
   * or scaled.
   *
   * On an axis whose world scale is 0 the world transform collapses that axis,
   * so no local point maps back and the result is non-finite there. A caller
   * that can be handed such a transform checks `Number.isFinite`.
   */
  worldToLocal(point: Vec2Like): Vec2 {
    if (this._dirty) this._recompute();
    const dx = point.x - this._worldPositionX;
    const dy = point.y - this._worldPositionY;
    const cos = Math.cos(-this._worldRotation);
    const sin = Math.sin(-this._worldRotation);
    return new Vec2(
      (dx * cos - dy * sin) / this._worldScaleX,
      (dx * sin + dy * cos) / this._worldScaleY,
    );
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

  private _finite(value: number, method: string, field: string): number {
    if (!Number.isFinite(value)) {
      throw new Error(
        `Transform.${method}: ${field} must be finite, got ${value}.`,
      );
    }
    return value;
  }

  private _recompute(): void {
    this._dirty = false;
    const pt = this.entity?.parent?.tryGet(Transform);
    this._worldPosition = undefined;
    this._worldScale = undefined;
    this._worldIsLocal = !pt;
    if (!pt) {
      // Root or no parent: world = local
      this._worldPositionX = this._positionX;
      this._worldPositionY = this._positionY;
      this._worldRotation = this._rotation;
      this._worldScaleX = this._scaleX;
      this._worldScaleY = this._scaleY;
      return;
    }
    // Compose with parent world (triggers parent recompute if needed)
    if (pt._dirty) pt._recompute();
    const x = this._positionX * pt._worldScaleX;
    const y = this._positionY * pt._worldScaleY;
    const cos = Math.cos(pt._worldRotation);
    const sin = Math.sin(pt._worldRotation);
    this._worldPositionX = pt._worldPositionX + (x * cos - y * sin);
    this._worldPositionY = pt._worldPositionY + (x * sin + y * cos);
    this._worldRotation = pt._worldRotation + this._rotation;
    this._worldScaleX = pt._worldScaleX * this._scaleX;
    this._worldScaleY = pt._worldScaleY * this._scaleY;
  }
}
