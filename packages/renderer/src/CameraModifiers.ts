import { Vec2 } from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";

/** Initial values for one camera contribution. */
export interface CameraModifierOptions {
  /** Additive world-space position offset. Default: `{ x: 0, y: 0 }`. */
  position?: Vec2Like;
  /** Additive rotation in radians. Default: `0`. */
  rotation?: number;
  /** Multiplicative zoom factor. Default: `1`. */
  zoom?: number;
}

/** Removable contribution owned by a {@link CameraModifierHost}. */
export interface CameraModifierHandle {
  /** Whether this contribution is still active. */
  readonly active: boolean;
  /** Replace this contribution's additive position offset. */
  setPosition(offset: Vec2Like): void;
  /** Replace this contribution's additive rotation offset. */
  setRotation(radians: number): void;
  /** Replace this contribution's multiplicative zoom factor. */
  setZoom(factor: number): void;
  /** Remove only this contribution. Safe to call more than once. */
  remove(): void;
}

interface CameraContribution {
  active: boolean;
  position: Vec2;
  rotation: number;
  zoom: number;
}

/** Transient contributions combined with a camera's authoritative values. */
export class CameraModifierHost {
  private readonly contributions = new Set<CameraContribution>();
  private _positionOffset = Vec2.ZERO;
  private _rotationOffset = 0;
  private _zoomFactor = 1;
  private destroyed = false;

  /** Combined additive world-space position offset. */
  get positionOffset(): Vec2 {
    return this._positionOffset;
  }

  /** Combined additive rotation offset in radians. */
  get rotationOffset(): number {
    return this._rotationOffset;
  }

  /** Combined multiplicative zoom factor. */
  get zoomFactor(): number {
    return this._zoomFactor;
  }

  /** Number of active contributions. */
  get size(): number {
    return this.contributions.size;
  }

  /** Add one independently removable camera contribution. */
  add(options: CameraModifierOptions = {}): CameraModifierHandle {
    this.assertLive();
    const contribution: CameraContribution = {
      active: true,
      position: options.position
        ? toFiniteVec2(options.position, "position")
        : Vec2.ZERO,
      rotation:
        options.rotation === undefined
          ? 0
          : finite(options.rotation, "rotation"),
      zoom: options.zoom === undefined ? 1 : positive(options.zoom, "zoom"),
    };
    this.contributions.add(contribution);
    this.recompute();

    return {
      get active() {
        return contribution.active;
      },
      setPosition: (offset) => {
        if (!contribution.active) return;
        contribution.position = toFiniteVec2(offset, "position");
        this.recompute();
      },
      setRotation: (radians) => {
        if (!contribution.active) return;
        contribution.rotation = finite(radians, "rotation");
        this.recompute();
      },
      setZoom: (factor) => {
        if (!contribution.active) return;
        contribution.zoom = positive(factor, "zoom");
        this.recompute();
      },
      remove: () => {
        if (!contribution.active) return;
        contribution.active = false;
        this.contributions.delete(contribution);
        this.recompute();
      },
    };
  }

  /** @internal Invalidates every outstanding handle during component teardown. */
  _destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const contribution of this.contributions) contribution.active = false;
    this.contributions.clear();
    this._positionOffset = Vec2.ZERO;
    this._rotationOffset = 0;
    this._zoomFactor = 1;
  }

  private assertLive(): void {
    if (this.destroyed) {
      throw new Error("CameraModifierHost: the owning camera was destroyed.");
    }
  }

  private recompute(): void {
    let position = Vec2.ZERO;
    let rotation = 0;
    let zoom = 1;
    for (const contribution of this.contributions) {
      position = position.add(contribution.position);
      rotation += contribution.rotation;
      zoom *= contribution.zoom;
    }
    this._positionOffset = position;
    this._rotationOffset = rotation;
    this._zoomFactor = zoom;
  }
}

function toFiniteVec2(value: Vec2Like, label: string): Vec2 {
  return new Vec2(finite(value.x, `${label}.x`), finite(value.y, `${label}.y`));
}

function positive(value: number, label: string): number {
  finite(value, label);
  if (value <= 0) {
    throw new Error(
      `CameraModifierHost: ${label} must be greater than 0, got ${value}.`,
    );
  }
  return value;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(
      `CameraModifierHost: ${label} must be finite, got ${value}.`,
    );
  }
  return value;
}
