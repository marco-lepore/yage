import { describe, expect, it, vi } from "vitest";

vi.mock("pixi.js", () => {
  class Filter {
    enabled = true;
    alpha = 1;
    resources: Record<string, { uniforms: Record<string, unknown> }>;

    constructor(
      options: {
        resources?: Record<string, Record<string, { value: unknown }>>;
      } = {},
    ) {
      const resources: Record<string, { uniforms: Record<string, unknown> }> =
        {};
      for (const [group, declarations] of Object.entries(
        options.resources ?? {},
      )) {
        const uniforms: Record<string, unknown> = {};
        for (const [name, declaration] of Object.entries(declarations)) {
          uniforms[name] = declaration.value;
        }
        resources[group] = { uniforms };
      }
      this.resources = resources;
    }

    apply(): void {}
  }

  class BlurFilter extends Filter {
    strengthX: number;
    strengthY: number;
    quality: number;
    repeatEdgePixels = false;

    constructor(options: {
      strengthX: number;
      strengthY: number;
      quality: number;
    }) {
      super();
      this.strengthX = options.strengthX;
      this.strengthY = options.strengthY;
      this.quality = options.quality;
    }
  }

  return {
    Filter,
    BlurFilter,
    GlProgram: { from: () => ({}) },
    GpuProgram: { from: () => ({}) },
  };
});

vi.mock("pixi-filters", () => {
  class GlitchFilter {
    enabled = true;
    alpha = 1;
    slices = 1;
    offset = 0;
    direction = 0;
    minSize = 8;
    sampleSize = 512;
    average = false;
    seed = 0;
    red = { x: 0, y: 0 };
    green = { x: 0, y: 0 };
    blue = { x: 0, y: 0 };
    sizes = new Float32Array(1);
    offsets = new Float32Array(1);

    constructor(options: {
      slices: number;
      offset: number;
      direction: number;
      average: boolean;
      minSize: number;
      sampleSize: number;
      red: { x: number; y: number };
      green: { x: number; y: number };
      blue: { x: number; y: number };
      seed: number;
    }) {
      Object.assign(this, options);
      this.sizes = new Float32Array(options.slices);
      this.offsets = new Float32Array(options.slices);
    }

    redraw(): void {}
    apply(): void {}
  }

  class ZoomBlurFilter {
    enabled = true;
    alpha = 1;
    strength: number;
    center: { x: number; y: number };
    innerRadius: number;
    radius: number;

    constructor(options: {
      strength: number;
      center: { x: number; y: number };
      innerRadius: number;
      radius: number;
    }) {
      this.strength = options.strength;
      this.center = options.center;
      this.innerRadius = options.innerRadius;
      this.radius = options.radius;
    }

    apply(): void {}
  }

  return { GlitchFilter, ZoomBlurFilter };
});

import { axisBlur } from "./axisBlur.js";
import { glitch } from "./glitch.js";
import { implosion } from "./implosion.js";
import { zoomBlur } from "./zoomBlur.js";

describe("advanced effects", () => {
  it("rejects fractional glitch slice counts", () => {
    expect(() => glitch({ slices: 2.5 })()).toThrow(
      "glitch: slices must be a finite integer >= 1.",
    );
  });

  it("glitch refreshes to the same pattern for the same seed", () => {
    const effect = glitch({ slices: 5, seed: 17 })();
    const filter = effect.filter as unknown as {
      sizes: Float32Array;
      offsets: Float32Array;
    };
    const handle = effect.buildExtras?.(null as never);
    if (!handle?.refresh) throw new Error("Expected a glitch refresh handle.");
    const initialSizes = [...filter.sizes];
    const initialOffsets = [...filter.offsets];

    handle.refresh(99);
    const seededSizes = [...filter.sizes];
    const seededOffsets = [...filter.offsets];
    expect(seededOffsets).not.toEqual(initialOffsets);

    handle.refresh(99);
    expect([...filter.sizes]).toEqual(seededSizes);
    expect([...filter.offsets]).toEqual(seededOffsets);
    expect(filter.sizes.reduce((sum, value) => sum + value, 0)).toBeCloseTo(
      1,
      5,
    );
    expect(initialSizes.reduce((sum, value) => sum + value, 0)).toBeCloseTo(
      1,
      5,
    );
  });

  it("glitch intensity scales displacement and color separation", () => {
    const effect = glitch({
      offset: 20,
      red: { x: 6, y: 2 },
      blue: { x: -4, y: 0 },
    })();
    effect.setIntensity(0.5);
    const filter = effect.filter as unknown as {
      offset: number;
      red: { x: number; y: number };
      blue: { x: number; y: number };
    };
    expect(filter.offset).toBe(10);
    expect(filter.red).toEqual({ x: 3, y: 1 });
    expect(filter.blue).toEqual({ x: -2, y: 0 });
  });

  it("zoom blur preserves intensity when its full strength changes", () => {
    const effect = zoomBlur({ strength: 0.2 })();
    effect.setIntensity(0.5);
    const handle = effect.buildExtras?.(null as never);
    if (!handle?.setStrength) {
      throw new Error("Expected a zoom-blur strength handle.");
    }
    handle.setStrength(0.4);
    const filter = effect.filter as unknown as { strength: number };
    expect(effect.getIntensity()).toBe(0.5);
    expect(filter.strength).toBeCloseTo(0.2, 5);
  });

  it("axis blur switches the main and perpendicular strengths", () => {
    const effect = axisBlur({
      axis: "horizontal",
      strength: 12,
      perpendicularStrength: 2,
    })();
    effect.setIntensity(0.5);
    const filter = effect.filter as unknown as {
      strengthX: number;
      strengthY: number;
    };
    expect(filter.strengthX).toBe(6);
    expect(filter.strengthY).toBe(1);

    const handle = effect.buildExtras?.(null as never);
    if (!handle?.setAxis) throw new Error("Expected an axis-blur handle.");
    handle.setAxis("vertical");
    expect(filter.strengthX).toBe(1);
    expect(filter.strengthY).toBe(6);
  });

  it("implosion intensity scales pull, darkness, and swirl together", () => {
    const effect = implosion({ strength: 0.8, darkness: 0.6, swirl: 0.4 })();
    effect.setIntensity(0.25);
    const uniforms = (
      effect.filter as unknown as {
        resources: {
          implosionUniforms: {
            uniforms: {
              uStrength: number;
              uDarkness: number;
              uSwirl: number;
            };
          };
        };
      }
    ).resources.implosionUniforms.uniforms;
    expect(uniforms.uStrength).toBeCloseTo(0.2, 5);
    expect(uniforms.uDarkness).toBeCloseTo(0.15, 5);
    expect(uniforms.uSwirl).toBeCloseTo(0.1, 5);
  });
});
