import { Vec2 } from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";

/** Initial values for one transform contribution. */
export interface VisualTransformModifierOptions {
  /** Additive offset in the render layer's coordinate space. Default: `{ x: 0, y: 0 }`. */
  position?: Vec2Like;
  /** Additive rotation in radians. Default: `0`. */
  rotation?: number;
  /** Multiplicative scale. A number applies to both axes. Default: `1`. */
  scale?: number | Vec2Like;
}

/** Removable transform contribution owned by a {@link VisualModifierHost}. */
export interface VisualTransformModifierHandle {
  /** Whether this contribution is still active. */
  readonly active: boolean;
  /** Replace this contribution's additive position offset. */
  setPosition(offset: Vec2Like): void;
  /** Replace this contribution's additive rotation offset. */
  setRotation(radians: number): void;
  /** Replace this contribution's multiplicative scale factor. */
  setScale(scale: number | Vec2Like): void;
  /** Remove only this contribution. Safe to call more than once. */
  remove(): void;
}

/** Removable opacity contribution owned by a {@link VisualModifierHost}. */
export interface VisualOpacityModifierHandle {
  /** Whether this contribution is still active. */
  readonly active: boolean;
  /** Replace this contribution's multiplicative opacity factor. */
  setFactor(factor: number): void;
  /** Remove only this contribution. Safe to call more than once. */
  remove(): void;
}

/** Removable visibility contribution owned by a {@link VisualModifierHost}. */
export interface VisualVisibilityModifierHandle {
  /** Whether this contribution is still active. */
  readonly active: boolean;
  /** Replace whether this contribution permits the visual to be shown. */
  setVisible(visible: boolean): void;
  /** Remove only this contribution. Safe to call more than once. */
  remove(): void;
}

interface TransformContribution {
  active: boolean;
  position: Vec2;
  rotation: number;
  scale: Vec2;
}

interface OpacityContribution {
  active: boolean;
  factor: number;
}

interface VisibilityContribution {
  active: boolean;
  visible: boolean;
}

/**
 * Transient render-only contributions for one visual component.
 *
 * The host stores offsets and factors, never the component's base values.
 * `DisplaySystem` combines the current world transform with these values every
 * render, so gameplay and physics remain authoritative while modifiers are
 * active.
 */
export class VisualModifierHost {
  private readonly transforms = new Set<TransformContribution>();
  private readonly opacities = new Set<OpacityContribution>();
  private readonly visibilities = new Set<VisibilityContribution>();
  private _positionOffset = Vec2.ZERO;
  private _rotationOffset = 0;
  private _scaleFactor = Vec2.ONE;
  private _opacityFactor = 1;
  private _visible = true;
  private destroyed = false;

  constructor(private readonly appearanceChanged?: () => void) {}

  /** Combined additive position offset. */
  get positionOffset(): Vec2 {
    return this._positionOffset;
  }

  /** Combined additive rotation offset in radians. */
  get rotationOffset(): number {
    return this._rotationOffset;
  }

  /** Combined multiplicative scale factor. */
  get scaleFactor(): Vec2 {
    return this._scaleFactor;
  }

  /** Combined multiplicative opacity factor. */
  get opacityFactor(): number {
    return this._opacityFactor;
  }

  /** Whether every active visibility contribution permits drawing. */
  get visible(): boolean {
    return this._visible;
  }

  /** Number of active contributions across every visual property. */
  get size(): number {
    return this.transforms.size + this.opacities.size + this.visibilities.size;
  }

  /** Whether at least one transform contribution is active. */
  get hasTransformModifiers(): boolean {
    return this.transforms.size > 0;
  }

  /** Add one independently removable transform contribution. */
  addTransform(
    options: VisualTransformModifierOptions = {},
  ): VisualTransformModifierHandle {
    this.assertLive();
    const contribution: TransformContribution = {
      active: true,
      position: options.position
        ? toFiniteVec2(options.position, "position")
        : Vec2.ZERO,
      rotation:
        options.rotation === undefined
          ? 0
          : finite(options.rotation, "rotation"),
      scale: resolveScale(options.scale),
    };
    this.transforms.add(contribution);
    this.recomputeTransform();

    return {
      get active() {
        return contribution.active;
      },
      setPosition: (offset) => {
        if (!contribution.active) return;
        contribution.position = toFiniteVec2(offset, "position");
        this.recomputeTransform();
      },
      setRotation: (radians) => {
        if (!contribution.active) return;
        contribution.rotation = finite(radians, "rotation");
        this.recomputeTransform();
      },
      setScale: (scale) => {
        if (!contribution.active) return;
        contribution.scale = resolveScale(scale);
        this.recomputeTransform();
      },
      remove: () => {
        if (!contribution.active) return;
        contribution.active = false;
        this.transforms.delete(contribution);
        this.recomputeTransform();
      },
    };
  }

  /** Add one independently removable opacity factor. */
  addOpacity(factor = 1): VisualOpacityModifierHandle {
    this.assertLive();
    const contribution: OpacityContribution = {
      active: true,
      factor: finite(factor, "opacity factor"),
    };
    this.opacities.add(contribution);
    this.recomputeOpacity();

    return {
      get active() {
        return contribution.active;
      },
      setFactor: (value) => {
        if (!contribution.active) return;
        contribution.factor = finite(value, "opacity factor");
        this.recomputeOpacity();
      },
      remove: () => {
        if (!contribution.active) return;
        contribution.active = false;
        this.opacities.delete(contribution);
        this.recomputeOpacity();
      },
    };
  }

  /** Add one independently removable visibility condition. */
  addVisibility(visible = true): VisualVisibilityModifierHandle {
    this.assertLive();
    const contribution: VisibilityContribution = { active: true, visible };
    this.visibilities.add(contribution);
    this.recomputeVisibility();

    return {
      get active() {
        return contribution.active;
      },
      setVisible: (value) => {
        if (!contribution.active) return;
        contribution.visible = value;
        this.recomputeVisibility();
      },
      remove: () => {
        if (!contribution.active) return;
        contribution.active = false;
        this.visibilities.delete(contribution);
        this.recomputeVisibility();
      },
    };
  }

  /** @internal Invalidates every outstanding handle during component teardown. */
  _destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const contribution of this.transforms) contribution.active = false;
    for (const contribution of this.opacities) contribution.active = false;
    for (const contribution of this.visibilities) contribution.active = false;
    this.transforms.clear();
    this.opacities.clear();
    this.visibilities.clear();
    this._positionOffset = Vec2.ZERO;
    this._rotationOffset = 0;
    this._scaleFactor = Vec2.ONE;
    this._opacityFactor = 1;
    this._visible = true;
  }

  private assertLive(): void {
    if (this.destroyed) {
      throw new Error(
        "VisualModifierHost: the owning component was destroyed.",
      );
    }
  }

  private recomputeTransform(): void {
    let position = Vec2.ZERO;
    let rotation = 0;
    let scale = Vec2.ONE;
    for (const contribution of this.transforms) {
      position = position.add(contribution.position);
      rotation += contribution.rotation;
      scale = scale.multiply(contribution.scale);
    }
    this._positionOffset = position;
    this._rotationOffset = rotation;
    this._scaleFactor = scale;
  }

  private recomputeOpacity(): void {
    let opacity = 1;
    for (const contribution of this.opacities) opacity *= contribution.factor;
    this._opacityFactor = opacity;
    this.appearanceChanged?.();
  }

  private recomputeVisibility(): void {
    let visible = true;
    for (const contribution of this.visibilities) {
      visible &&= contribution.visible;
    }
    this._visible = visible;
    this.appearanceChanged?.();
  }
}

function resolveScale(scale: number | Vec2Like | undefined): Vec2 {
  if (scale === undefined) return Vec2.ONE;
  if (typeof scale === "number") {
    const value = finite(scale, "scale");
    return new Vec2(value, value);
  }
  return toFiniteVec2(scale, "scale");
}

function toFiniteVec2(value: Vec2Like, label: string): Vec2 {
  return new Vec2(finite(value.x, `${label}.x`), finite(value.y, `${label}.y`));
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(
      `VisualModifierHost: ${label} must be finite, got ${value}.`,
    );
  }
  return value;
}
