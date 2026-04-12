import { Component } from "./Component.js";
import { serializable } from "./Serializable.js";
import { Vec2 } from "./Vec2.js";
import type { Vec2Like } from "./Vec2.js";

/** Serialized transform state. */
export interface TransformData {
  position: { x: number; y: number };
  rotation: number;
  scale: { x: number; y: number };
}

/** Mutable transform component for entity positioning. */
@serializable
export class Transform extends Component {
  // Private backing fields
  private _position: Vec2;
  private _rotation: number;
  private _scale: Vec2;
  private _worldPosition: Vec2;
  private _worldRotation: number;
  private _worldScale: Vec2;
  private _dirty = false;

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

  /** Set position in world space. Back-computes the local position from the parent chain. */
  set worldPosition(v: Vec2) {
    const pt = this.entity?.parent?.tryGet(Transform);
    if (!pt) {
      this._position = v;
    } else {
      const delta = v.sub(pt.worldPosition).rotate(-pt.worldRotation);
      const ps = pt.worldScale;
      this._position = new Vec2(delta.x / ps.x, delta.y / ps.y);
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

  // ---- Save/load support ----

  serialize(): TransformData {
    return {
      position: { x: this._position.x, y: this._position.y },
      rotation: this._rotation,
      scale: { x: this._scale.x, y: this._scale.y },
    };
  }

  static fromSnapshot(data: TransformData): Transform {
    return new Transform({
      position: { x: data.position.x, y: data.position.y },
      rotation: data.rotation,
      scale: { x: data.scale.x, y: data.scale.y },
    });
  }
}
