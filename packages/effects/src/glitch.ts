import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { GlitchFilter } from "pixi-filters";
import type {
  Container,
  FilterSystem,
  PointData,
  RenderSurface,
  Texture,
} from "pixi.js";
import type { GlitchHandle } from "./handles.js";

export type GlitchFillMode =
  | "transparent"
  | "original"
  | "loop"
  | "clamp"
  | "mirror";

/** Options for the {@link glitch} preset. */
export interface GlitchOptions {
  /** Number of horizontal displacement bands. Default: 8. */
  slices?: number;
  /** Maximum band displacement in host-local pixels. Default: 24. */
  offset?: number;
  /** Band displacement direction in degrees. Default: 0. */
  direction?: number;
  /** How displaced pixels fill exposed space. Default: `"original"`. */
  fillMode?: GlitchFillMode;
  /** Keep band sizes closer to equal. Default: false. */
  average?: boolean;
  /** Minimum band height used by the displacement map. Default: 8. */
  minSize?: number;
  /** Displacement-map height. Default: 512. */
  sampleSize?: number;
  /** Red-channel displacement in host-local pixels. Default: `{ x: 4, y: 0 }`. */
  red?: { x: number; y: number };
  /** Green-channel displacement in host-local pixels. Default: `{ x: 0, y: 0 }`. */
  green?: { x: number; y: number };
  /** Blue-channel displacement in host-local pixels. Default: `{ x: -4, y: 0 }`. */
  blue?: { x: number; y: number };
  /** Initial deterministic pattern seed. Default: 0. */
  seed?: number;
}

const FILL_MODES: Record<GlitchFillMode, number> = {
  transparent: 0,
  original: 1,
  loop: 2,
  clamp: 3,
  mirror: 4,
};

function randomFromSeed(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    let value = (state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function validateSlices(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`glitch: slices must be a finite integer >= 1.`);
  }
  return value;
}

class YageGlitchFilter extends GlitchFilter {
  intensity = 1;
  baseOffsetLocal: number;
  baseRedLocal: PointData;
  baseGreenLocal: PointData;
  baseBlueLocal: PointData;
  yageTarget: Container | undefined;
  private patternSeed: number;

  constructor(options: GlitchOptions) {
    const slices = validateSlices(options.slices ?? 8);
    const red = options.red ?? { x: 4, y: 0 };
    const green = options.green ?? { x: 0, y: 0 };
    const blue = options.blue ?? { x: -4, y: 0 };
    const seed = options.seed ?? 0;
    super({
      slices,
      offset: options.offset ?? 24,
      direction: options.direction ?? 0,
      fillMode: FILL_MODES[options.fillMode ?? "original"],
      average: options.average ?? false,
      minSize: options.minSize ?? 8,
      sampleSize: options.sampleSize ?? 512,
      red,
      green,
      blue,
      seed: (seed >>> 0) / 0x1_0000_0000,
    });
    this.baseOffsetLocal = options.offset ?? 24;
    this.baseRedLocal = { ...red };
    this.baseGreenLocal = { ...green };
    this.baseBlueLocal = { ...blue };
    this.patternSeed = seed >>> 0;
    this.refreshSeeded(this.patternSeed);
    this.applyIntensity(1, 1);
  }

  refreshSeeded(seed = (this.patternSeed + 1) >>> 0): void {
    this.patternSeed = seed >>> 0;
    const random = randomFromSeed(this.patternSeed);
    const count = this.slices;
    const minFraction = Math.min(this.minSize / this.sampleSize, 0.9 / count);
    const remaining = Math.max(0, 1 - minFraction * count);
    const weights = Array.from({ length: count }, () => 0.2 + random());
    const weightTotal = weights.reduce((sum, value) => sum + value, 0);
    const sizes = new Float32Array(count);
    const offsets = new Float32Array(count);
    for (let index = 0; index < count; index++) {
      sizes[index] =
        minFraction + remaining * ((weights[index] ?? 0) / weightTotal);
      offsets[index] = random() * 2 - 1;
    }
    this.sizes = sizes;
    this.offsets = offsets;
    this.seed = random();
    this.redraw();
  }

  applyIntensity(scaleX: number, scaleY: number): void {
    const sizeScale = (scaleX + scaleY) * 0.5;
    this.offset = this.baseOffsetLocal * this.intensity * sizeScale;
    this.red = {
      x: this.baseRedLocal.x * this.intensity * scaleX,
      y: this.baseRedLocal.y * this.intensity * scaleY,
    };
    this.green = {
      x: this.baseGreenLocal.x * this.intensity * scaleX,
      y: this.baseGreenLocal.y * this.intensity * scaleY,
    };
    this.blue = {
      x: this.baseBlueLocal.x * this.intensity * scaleX,
      y: this.baseBlueLocal.y * this.intensity * scaleY,
    };
  }

  override apply(
    filterManager: FilterSystem,
    input: Texture,
    output: RenderSurface,
    clearMode: boolean,
  ): void {
    const transform = this.yageTarget?.worldTransform;
    const scaleX = transform ? Math.hypot(transform.a, transform.b) : 1;
    const scaleY = transform ? Math.hypot(transform.c, transform.d) : 1;
    this.applyIntensity(scaleX, scaleY);
    super.apply(filterManager, input, output, clearMode);
  }
}

/**
 * Horizontal slice displacement with independent RGB offsets. The persistent
 * effect keeps one deterministic pattern until {@link GlitchHandle.refresh}
 * is called. Use Feel's `feelGlitch` when the pattern should change during a
 * short cue.
 */
export const glitch = defineEffect<GlitchHandle, GlitchOptions>({
  name: "yage:glitch",
  factory: (options) => {
    const filter = new YageGlitchFilter(options);
    const effect: Effect<GlitchHandle> = {
      filter,
      getIntensity: () => filter.intensity,
      setIntensity: (value) => {
        filter.intensity = value;
        filter.applyIntensity(1, 1);
      },
      onAttach: ({ displayObject }) => {
        filter.yageTarget = displayObject;
      },
      onDetach: () => {
        filter.yageTarget = undefined;
      },
      buildExtras: () => ({
        refresh: (seed?: number) => filter.refreshSeeded(seed),
        setOffset: (value: number) => {
          filter.baseOffsetLocal = value;
          filter.applyIntensity(1, 1);
        },
        setColorOffsets: (red, green, blue) => {
          filter.baseRedLocal = { ...red };
          filter.baseGreenLocal = { ...green };
          filter.baseBlueLocal = { ...blue };
          filter.applyIntensity(1, 1);
        },
      }),
    };
    return effect;
  },
});
