import { Component, Transform } from "@yagejs/core";
import type { Vec2 } from "@yagejs/core";
import type { LightingWorld } from "./LightingWorld.js";
import { LightingWorldKey } from "./types.js";
import { assertColor, assertPositive, assertUnit } from "./validation.js";

/** Options accepted by {@link LightSource}. */
export interface LightSourceOptions {
  /** Light radius in world pixels. */
  radius: number;
  /** Peak contribution at the light's centre, from 0 to 1. Default `1`. */
  intensity?: number;
  /** RGB tint used by renderers that support coloured light. Default `0xffffff`. */
  color?: number;
  /** Whether the source starts enabled. Default `true`. */
  enabled?: boolean;
}

/**
 * A radial light centred on its entity's `Transform.worldPosition`.
 *
 * The radius and `levelAt()` contribution use world pixels. Transform scale
 * does not resize the light; set {@link radius} when the gameplay radius changes.
 */
export class LightSource extends Component {
  private readonly transform = this.sibling(Transform);
  private world: LightingWorld | undefined;
  private _radius: number;
  private _intensity: number;
  private _color: number;

  constructor(options: LightSourceOptions) {
    super();
    assertPositive(options.radius, "LightSource radius");
    assertUnit(options.intensity ?? 1, "LightSource intensity");
    assertColor(options.color ?? 0xffffff, "LightSource color");

    this._radius = options.radius;
    this._intensity = options.intensity ?? 1;
    this._color = options.color ?? 0xffffff;
    this.enabled = options.enabled ?? true;
  }

  /** Current world-space centre. */
  get position(): Vec2 {
    return this.transform.worldPosition;
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
