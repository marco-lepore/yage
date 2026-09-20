import { Component, Transform } from "@yagejs/core";
import type { Vec2, Vec2Buffer } from "@yagejs/core";
import type { LightingWorld } from "./LightingWorld.js";
import { LightingWorldKey } from "./types.js";
import type { LightConeOptions } from "./types.js";
import {
  FULL_TURN,
  assertColor,
  assertNonNegative,
  assertPositive,
  assertSpread,
  assertUnit,
} from "./validation.js";

/** Options accepted by {@link LightSource}. */
export interface LightSourceOptions {
  /** Light radius in world pixels. */
  radius: number;
  /** Peak contribution at the light's centre, from 0 to 1. Default `1`. */
  intensity?: number;
  /** RGB tint used by renderers that support coloured light. Default `0xffffff`. */
  color?: number;
  /** Lamp diameter in world pixels, from 0 upwards. Default `0`. */
  size?: number;
  /** Spotlight cone. Omit for a light that shines in every direction. */
  cone?: LightConeOptions;
  /** Whether occluders block this light. Default `true`. */
  castShadows?: boolean;
  /** Whether the source starts enabled. Default `true`. */
  enabled?: boolean;
}

/**
 * A radial light centred on its entity's `Transform.worldPosition`.
 *
 * The radius and `levelAt()` contribution use world pixels. Transform scale
 * does not resize the light; set {@link radius} when the gameplay radius changes.
 *
 * {@link size} is the lamp itself rather than its reach: a lamp wider than a
 * point is partly hidden behind a blocker's edge, so its shadows carry a soft
 * border that widens with the distance from the blocker. {@link coneAngle}
 * narrows the light to a spotlight aimed along the entity's world rotation.
 */
export class LightSource extends Component {
  private readonly transform = this.sibling(Transform);
  private world: LightingWorld | undefined;
  private _radius: number;
  private _intensity: number;
  private _color: number;
  private _size: number;
  private _coneAngle: number;
  /**
   * Whether occluders block this light. Set it to `false` for a light that
   * shines through walls, such as a global fill or a UI highlight.
   */
  castShadows: boolean;

  constructor(options: LightSourceOptions) {
    super();
    assertPositive(options.radius, "LightSource radius");
    assertUnit(options.intensity ?? 1, "LightSource intensity");
    assertColor(options.color ?? 0xffffff, "LightSource color");
    assertNonNegative(options.size ?? 0, "LightSource size");
    if (options.cone) {
      assertSpread(options.cone.angle, "LightSource cone angle");
    }

    this._radius = options.radius;
    this._intensity = options.intensity ?? 1;
    this._color = options.color ?? 0xffffff;
    this._size = options.size ?? 0;
    this._coneAngle = options.cone?.angle ?? FULL_TURN;
    this.castShadows = options.castShadows ?? true;
    this.enabled = options.enabled ?? true;
  }

  /** Current world-space centre. */
  get position(): Vec2 {
    return this.transform.worldPosition;
  }

  /** Copy world coordinates into caller-owned scratch. */
  getPositionInto(out: Vec2Buffer): Vec2Buffer {
    return this.transform.getWorldPositionInto(out);
  }

  /** Current world rotation in radians, which aims {@link coneAngle}. */
  get rotation(): number {
    return this.transform.worldRotation;
  }

  /** Radius in world pixels. */
  get radius(): number {
    return this._radius;
  }

  set radius(value: number) {
    assertPositive(value, "LightSource radius");
    if (value === this._radius) return;
    this._radius = value;
  }

  /** Peak contribution at the light's centre, from 0 to 1. */
  get intensity(): number {
    return this._intensity;
  }

  set intensity(value: number) {
    assertUnit(value, "LightSource intensity");
    if (value === this._intensity) return;
    this._intensity = value;
  }

  /**
   * Lamp diameter in world pixels. A wider lamp gives a wider shadow border
   * and dims a partly hidden point instead of switching it off; `0` is a point
   * lamp with hard shadows.
   */
  get size(): number {
    return this._size;
  }

  set size(value: number) {
    assertNonNegative(value, "LightSource size");
    if (value === this._size) return;
    this._size = value;
  }

  /**
   * Spotlight spread in radians, aimed along {@link rotation}. A whole turn is
   * a light that shines in every direction.
   */
  get coneAngle(): number {
    return this._coneAngle;
  }

  set coneAngle(value: number) {
    assertSpread(value, "LightSource cone angle");
    if (value === this._coneAngle) return;
    this._coneAngle = value;
  }

  /** RGB tint used by renderers that support coloured light. */
  get color(): number {
    return this._color;
  }

  set color(value: number) {
    assertColor(value, "LightSource color");
    if (value === this._color) return;
    this._color = value;
  }

  onEnable(): void {
    this.world ??= this.use(LightingWorldKey);
    this.world.registerSource(this);
  }

  onDisable(): void {
    this.world?.unregisterSource(this);
  }

  onDestroy(): void {
    this.world?.unregisterSource(this);
    this.world = undefined;
  }
}
