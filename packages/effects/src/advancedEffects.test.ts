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

  class Color {
    constructor(private readonly value: number) {}

    toArray(): number[] {
      return [
        ((this.value >> 16) & 0xff) / 255,
        ((this.value >> 8) & 0xff) / 255,
        (this.value & 0xff) / 255,
        1,
      ];
    }
  }

  return {
    Color,
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

  class BulgePinchFilter {
    enabled = true;
    alpha = 1;
    uniforms: {
      uDimensions: number[];
      uCenter: { x: number; y: number };
      uRadius: number;
      uStrength: number;
    };

    constructor(options: {
      strength: number;
      radius: number;
      center: { x: number; y: number };
    }) {
      this.uniforms = {
        uDimensions: [0, 0],
        uCenter: options.center,
        uRadius: options.radius,
        uStrength: options.strength,
      };
    }

    get center(): { x: number; y: number } {
      return this.uniforms.uCenter;
    }

    set center(value: { x: number; y: number }) {
      this.uniforms.uCenter = value;
    }

    get radius(): number {
      return this.uniforms.uRadius;
    }

    set radius(value: number) {
      this.uniforms.uRadius = value;
    }

    get strength(): number {
      return this.uniforms.uStrength;
    }

    set strength(value: number) {
      this.uniforms.uStrength = value;
    }

    apply(
      _filterManager: unknown,
      input: { frame: { width: number; height: number } },
    ): void {
      this.uniforms.uDimensions[0] = input.frame.width;
      this.uniforms.uDimensions[1] = input.frame.height;
    }
  }

  class ShockwaveFilter {
    enabled = true;
    alpha = 1;
    time: number;
    center: { x: number; y: number };
    speed: number;
    amplitude: number;
    wavelength: number;
    brightness: number;
    radius: number;

    constructor(options: {
      speed: number;
      amplitude: number;
      wavelength: number;
      brightness: number;
      radius: number;
      time: number;
    }) {
      this.speed = options.speed;
      this.amplitude = options.amplitude;
      this.wavelength = options.wavelength;
      this.brightness = options.brightness;
      this.radius = options.radius;
      this.time = options.time;
      this.center = { x: 0, y: 0 };
    }

    apply(): void {}
  }

  return { GlitchFilter, ZoomBlurFilter, BulgePinchFilter, ShockwaveFilter };
});

import type { Process } from "@yagejs/core";
import { axisBlur } from "./axisBlur.js";
import { bulgePinch } from "./bulgePinch.js";
import { dissolve } from "./dissolve.js";
import { glitch } from "./glitch.js";
import { implosion } from "./implosion.js";
import { shockwave } from "./shockwave.js";
import type { ShockwaveDirection } from "./shockwave.js";
import { zoomBlur } from "./zoomBlur.js";

/** `time` the preset parks the ring at while no ramp is running. */
const PARKED_TIME = 1e6;

/**
 * Arm a shockwave and hand back its filter plus the ramp the trigger
 * scheduled, so a test can step the ramp without an engine.
 */
function armShockwave(
  options: Parameters<typeof shockwave>[0],
  x = 0,
  y = 0,
): {
  filter: { time: number; centerLocal: { x: number; y: number } };
  ramp: Process;
  trigger(x?: number, y?: number): void;
} {
  const effect = shockwave(options)();
  let scheduled: Process | undefined;
  const base = {
    run: (process: Process) => {
      scheduled = process;
      return process;
    },
  } as never;
  const handle = effect.buildExtras?.(base);
  if (!handle?.trigger) throw new Error("Expected a shockwave handle.");
  handle.trigger(x, y);
  if (!scheduled) throw new Error("Expected the trigger to schedule a ramp.");
  return {
    filter: effect.filter as unknown as {
      time: number;
      centerLocal: { x: number; y: number };
    },
    ramp: scheduled,
    trigger: handle.trigger,
  };
}

describe("advanced effects", () => {
  it("rejects fractional glitch slice counts", () => {
    expect(() => glitch({ slices: 2.5 })()).toThrow(
      "glitch: slices must be an integer >= 1, got 2.5.",
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
    const effect = zoomBlur({
      strength: 0.2,
      radius: 100,
      expandFromCenter: true,
    })();
    effect.setIntensity(0.5);
    const handle = effect.buildExtras?.(null as never);
    if (!handle?.setStrength) {
      throw new Error("Expected a zoom-blur strength handle.");
    }
    handle.setStrength(0.4);
    const filter = effect.filter as unknown as {
      strength: number;
      radius: number;
      expandFromCenter: boolean;
      apply(...args: unknown[]): void;
    };
    filter.apply({}, { frame: { width: 200, height: 100 } }, {}, false);
    expect(effect.getIntensity()).toBe(0.5);
    expect(filter.strength).toBeCloseTo(0.2, 5);
    expect(filter.radius).toBeCloseTo(100 * Math.pow(0.5, 1.35), 5);

    handle.setExpandFromCenter(false);
    filter.apply({}, { frame: { width: 200, height: 100 } }, {}, false);
    expect(filter.expandFromCenter).toBe(false);
    expect(filter.radius).toBe(100);
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

  it("implosion intensity scales its channels and advances an optional front", () => {
    const effect = implosion({
      strength: 0.8,
      darkness: 0.6,
      swirl: 0.4,
      expandFromCenter: true,
    })();
    effect.setIntensity(0.25);
    const uniforms = (
      effect.filter as unknown as {
        resources: {
          implosionUniforms: {
            uniforms: {
              uStrength: number;
              uDarkness: number;
              uSwirl: number;
              uIntensity: number;
              uExpandFromCenter: number;
            };
          };
        };
      }
    ).resources.implosionUniforms.uniforms;
    expect(uniforms.uStrength).toBeCloseTo(0.2, 5);
    expect(uniforms.uDarkness).toBeCloseTo(0.15, 5);
    expect(uniforms.uSwirl).toBeCloseTo(0.1, 5);
    expect(uniforms.uIntensity).toBeCloseTo(0.25, 5);
    expect(uniforms.uExpandFromCenter).toBe(1);

    const handle = effect.buildExtras?.(null as never);
    if (!handle?.setExpandFromCenter) {
      throw new Error("Expected an implosion handle.");
    }
    handle.setExpandFromCenter(false);
    expect(uniforms.uExpandFromCenter).toBe(0);
  });

  it("dissolve intensity advances progress and its handle updates the edge", () => {
    const effect = dissolve({
      edgeColor: 0x336699,
      edgeWidth: 0.1,
      noiseScale: 10,
      softness: 0.03,
      seed: 4,
    })();
    effect.setIntensity(0.6);
    const handle = effect.buildExtras?.(null as never);
    if (!handle?.setEdgeColor) {
      throw new Error("Expected a dissolve handle.");
    }
    handle.setEdgeColor(0xff8000);
    handle.setEdgeWidth(0.2);
    handle.setNoiseScale(18);
    handle.setSoftness(0.04);
    handle.setSeed(9);

    const uniforms = (
      effect.filter as unknown as {
        resources: {
          dissolveUniforms: {
            uniforms: {
              uEdgeColor: number[];
              uProgress: number;
              uEdgeWidth: number;
              uNoiseScale: number;
              uSoftness: number;
              uSeed: number;
            };
          };
        };
      }
    ).resources.dissolveUniforms.uniforms;
    expect(effect.getIntensity()).toBe(0.6);
    expect(uniforms.uProgress).toBe(0.6);
    expect(uniforms.uEdgeColor).toEqual([1, 128 / 255, 0]);
    expect(uniforms.uEdgeWidth).toBe(0.2);
    expect(uniforms.uNoiseScale).toBe(18);
    expect(uniforms.uSoftness).toBe(0.04);
    expect(uniforms.uSeed).toBe(9);
  });

  it("keeps dissolve noise cells in host-local pixels", () => {
    const effect = dissolve({ noiseScale: 10 })();
    effect.onAttach?.({
      displayObject: {
        worldTransform: { a: 2, b: 0, c: 0, d: 2 },
      } as never,
      scope: "component",
    });
    const filter = effect.filter as unknown as {
      resources: {
        dissolveUniforms: { uniforms: { uNoiseScale: number } };
      };
      apply(...args: unknown[]): void;
    };

    filter.apply({}, {}, {}, false);
    expect(filter.resources.dissolveUniforms.uniforms.uNoiseScale).toBe(20);

    const handle = effect.buildExtras?.(null as never);
    if (!handle?.setNoiseScale) {
      throw new Error("Expected a dissolve handle.");
    }
    handle.setNoiseScale(6);
    expect(filter.resources.dissolveUniforms.uniforms.uNoiseScale).toBe(12);

    effect.onDetach?.();
    filter.apply({}, {}, {}, false);
    expect(filter.resources.dissolveUniforms.uniforms.uNoiseScale).toBe(6);
  });

  it("rejects invalid dissolve options and runtime values", () => {
    expect(() => dissolve({ edgeWidth: 0 })()).toThrow(/edgeWidth/);
    expect(() => dissolve({ noiseScale: Number.NaN })()).toThrow(/noiseScale/);
    expect(() => dissolve({ softness: 0.5 })()).toThrow(/softness/);
    expect(() => dissolve({ seed: Number.POSITIVE_INFINITY })()).toThrow(
      /seed/,
    );

    const effect = dissolve({})();
    const handle = effect.buildExtras?.(null as never);
    if (!handle?.setEdgeWidth) {
      throw new Error("Expected a dissolve handle.");
    }
    expect(() => effect.setIntensity(Number.NaN)).toThrow(/intensity/);
    expect(() => handle.setEdgeWidth(0)).toThrow(/edgeWidth/);
    expect(() => handle.setNoiseScale(0)).toThrow(/noiseScale/);
    expect(() => handle.setSoftness(Number.NaN)).toThrow(/softness/);
    expect(() => handle.setSeed(Number.POSITIVE_INFINITY)).toThrow(/seed/);
  });

  it("rejects invalid glitch options and runtime values", () => {
    expect(() => glitch({ offset: Number.NaN })()).toThrow(/offset/);
    expect(() => glitch({ direction: Number.POSITIVE_INFINITY })()).toThrow(
      /direction/,
    );
    expect(() => glitch({ sampleSize: 0 })()).toThrow(/sampleSize/);
    expect(() => glitch({ seed: Number.NaN })()).toThrow(/seed/);
    expect(() => glitch({ red: { x: Number.NaN, y: 0 } })()).toThrow(/red\.x/);

    const effect = glitch({})();
    const handle = effect.buildExtras?.(null as never);
    if (!handle?.setOffset) {
      throw new Error("Expected a glitch handle.");
    }
    expect(() => effect.setIntensity(Number.NaN)).toThrow(/intensity/);
    expect(() => handle.setOffset(Number.POSITIVE_INFINITY)).toThrow(/offset/);
    expect(() =>
      handle.setColorOffsets(
        { x: 0, y: Number.NaN },
        { x: 0, y: 0 },
        {
          x: 0,
          y: 0,
        },
      ),
    ).toThrow(/red\.y/);
    expect(() => handle.refresh(Number.NaN)).toThrow(/seed/);
  });

  it("rejects invalid zoom blur options and runtime values", () => {
    expect(() => zoomBlur({ strength: Number.NaN })()).toThrow(/strength/);
    expect(() => zoomBlur({ innerRadius: -1 })()).toThrow(/innerRadius/);
    expect(() => zoomBlur({ radius: Number.POSITIVE_INFINITY })()).toThrow(
      /radius/,
    );
    expect(() => zoomBlur({ maxKernelSize: 0 })()).toThrow(/maxKernelSize/);
    expect(() => zoomBlur({ center: { x: 0, y: Number.NaN } })()).toThrow(
      /center\.y/,
    );

    const effect = zoomBlur({})();
    const handle = effect.buildExtras?.(null as never);
    if (!handle?.setRadii) {
      throw new Error("Expected a zoom blur handle.");
    }
    expect(() => effect.setIntensity(Number.NaN)).toThrow(/intensity/);
    expect(() => handle.setStrength(Number.NaN)).toThrow(/strength/);
    expect(() => handle.setCenter(Number.NaN, 0)).toThrow(/center\.x/);
    expect(() => handle.setRadii(-1, 10)).toThrow(/innerRadius/);
    expect(() => handle.setRadii(0, Number.NaN)).toThrow(/radius/);
  });

  it("rejects invalid axis blur options and runtime values", () => {
    expect(() => axisBlur({ strength: Number.NaN })()).toThrow(/strength/);
    expect(() =>
      axisBlur({ perpendicularStrength: Number.POSITIVE_INFINITY })(),
    ).toThrow(/perpendicularStrength/);
    expect(() => axisBlur({ quality: 1.5 })()).toThrow(/quality/);

    const effect = axisBlur({})();
    const handle = effect.buildExtras?.(null as never);
    if (!handle?.setStrength) {
      throw new Error("Expected an axis blur handle.");
    }
    expect(() => effect.setIntensity(Number.NaN)).toThrow(/intensity/);
    expect(() => handle.setStrength(Number.NaN)).toThrow(/strength/);
    expect(() => handle.setPerpendicularStrength(Number.NaN)).toThrow(
      /perpendicularStrength/,
    );
  });

  it("rejects invalid implosion options and runtime values", () => {
    expect(() => implosion({ radius: 0 })()).toThrow(/radius/);
    expect(() => implosion({ strength: Number.NaN })()).toThrow(/strength/);
    expect(() => implosion({ darkness: 1.5 })()).toThrow(/darkness/);
    expect(() => implosion({ swirl: Number.POSITIVE_INFINITY })()).toThrow(
      /swirl/,
    );
    expect(() => implosion({ center: { x: Number.NaN, y: 0 } })()).toThrow(
      /center\.x/,
    );

    const effect = implosion({})();
    const handle = effect.buildExtras?.(null as never);
    if (!handle?.setRadius) {
      throw new Error("Expected an implosion handle.");
    }
    expect(() => effect.setIntensity(Number.NaN)).toThrow(/intensity/);
    expect(() => handle.setRadius(0)).toThrow(/radius/);
    expect(() => handle.setStrength(Number.NaN)).toThrow(/strength/);
    expect(() => handle.setDarkness(-0.1)).toThrow(/darkness/);
    expect(() => handle.setSwirl(Number.NaN)).toThrow(/swirl/);
    expect(() => handle.setCenter(0, Number.NaN)).toThrow(/center\.y/);
  });
  it("maps a bulge-pinch center from host-local pixels onto the filter region", () => {
    const effect = bulgePinch({ radius: 100, center: { x: 120, y: 80 } })();
    effect.onAttach?.({
      displayObject: {
        worldTransform: { a: 0.5, b: 0, c: 0, d: 0.5, tx: 100, ty: 20 },
      } as never,
      scope: "component",
    });
    const filter = effect.filter as unknown as {
      uniforms: { uCenter: { x: number; y: number }; uRadius: number };
      apply(...args: unknown[]): void;
    };

    filter.apply(
      { _activeFilterData: { bounds: { minX: 40, minY: 10 } } },
      { frame: { width: 400, height: 200 } },
      {},
      false,
    );

    expect(filter.uniforms.uCenter.x).toBeCloseTo(0.3, 10);
    expect(filter.uniforms.uCenter.y).toBeCloseTo(0.25, 10);
    // Radius is host-local too: 100 local px under a half-scale host.
    expect(filter.uniforms.uRadius).toBe(50);
  });

  it("centers bulge-pinch on the filtered region without a host-local point", () => {
    const attach = {
      displayObject: {
        worldTransform: { a: 0.5, b: 0, c: 0, d: 0.5, tx: 100, ty: 20 },
      } as never,
      scope: "component" as const,
    };
    const manager = { _activeFilterData: { bounds: { minX: 40, minY: 10 } } };
    const input = { frame: { width: 400, height: 200 } };

    const noCenter = bulgePinch({})();
    noCenter.onAttach?.(attach);
    const noCenterFilter = noCenter.filter as unknown as {
      uniforms: { uCenter: { x: number; y: number } };
      apply(...args: unknown[]): void;
    };
    noCenterFilter.apply(manager, input, {}, false);
    expect(noCenterFilter.uniforms.uCenter).toEqual({ x: 0.5, y: 0.5 });

    const detached = bulgePinch({ center: { x: 120, y: 80 } })();
    detached.onAttach?.(attach);
    detached.onDetach?.();
    const detachedFilter = detached.filter as unknown as {
      uniforms: { uCenter: { x: number; y: number } };
      apply(...args: unknown[]): void;
    };
    detachedFilter.apply(manager, input, {}, false);
    expect(detachedFilter.uniforms.uCenter).toEqual({ x: 0.5, y: 0.5 });
  });

  it("returns a bulge-pinch lens to the region center on useHostCenter", () => {
    const effect = bulgePinch({})();
    effect.onAttach?.({
      displayObject: {
        worldTransform: { a: 0.5, b: 0, c: 0, d: 0.5, tx: 100, ty: 20 },
      } as never,
      scope: "component",
    });
    const filter = effect.filter as unknown as {
      uniforms: { uCenter: { x: number; y: number } };
      apply(...args: unknown[]): void;
    };
    const manager = { _activeFilterData: { bounds: { minX: 40, minY: 10 } } };
    const input = { frame: { width: 400, height: 200 } };

    const handle = effect.buildExtras?.(null as never);
    if (!handle?.useHostCenter) {
      throw new Error("Expected a bulge pinch handle.");
    }
    handle.setCenter(120, 80);
    filter.apply(manager, input, {}, false);
    expect(filter.uniforms.uCenter.x).toBeCloseTo(0.3, 10);

    handle.useHostCenter();
    filter.apply(manager, input, {}, false);
    expect(filter.uniforms.uCenter).toEqual({ x: 0.5, y: 0.5 });
  });

  it("rejects invalid bulge pinch options and runtime values", () => {
    expect(() => bulgePinch({ radius: -1 })()).toThrow(/radius/);
    expect(() => bulgePinch({ center: { x: Number.NaN, y: 0 } })()).toThrow(
      /center\.x/,
    );
    expect(() => bulgePinch({ strength: Number.POSITIVE_INFINITY })()).toThrow(
      /strength/,
    );

    const effect = bulgePinch({})();
    const handle = effect.buildExtras?.(null as never);
    if (!handle?.setRadius) {
      throw new Error("Expected a bulge pinch handle.");
    }
    expect(() => effect.setIntensity(Number.NaN)).toThrow(/intensity/);
    expect(() => handle.setStrength(Number.NaN)).toThrow(/strength/);
    expect(() => handle.setRadius(-1)).toThrow(/radius/);
    expect(() => handle.setCenter(0, Number.NaN)).toThrow(/center\.y/);
  });

  it("runs an outward shockwave from the trigger point", () => {
    const { filter, ramp } = armShockwave({ duration: 1 }, 10, 20);
    expect(filter.time).toBe(0);
    expect(filter.centerLocal).toEqual({ x: 10, y: 20 });

    ramp._update(0.25);
    ramp._update(0.25);
    expect(filter.time).toBeCloseTo(0.5, 10);
  });

  it("runs an inward shockwave from a full duration out", () => {
    const { filter, ramp } = armShockwave({
      direction: "in",
      duration: 0.5,
    });
    expect(filter.time).toBe(0.5);

    ramp._update(0.2);
    expect(filter.time).toBeCloseTo(0.3, 10);
  });

  it("parks the shockwave ring when either ramp completes", () => {
    const outward = armShockwave({ duration: 0.5 });
    outward.ramp._update(0.6);
    expect(outward.filter.time).toBe(PARKED_TIME);

    const inward = armShockwave({ direction: "in", duration: 0.5 });
    inward.ramp._update(0.6);
    expect(inward.filter.time).toBe(PARKED_TIME);
  });

  it("restarts a shockwave ramp from the configured direction's start", () => {
    const { filter, ramp, trigger } = armShockwave({
      direction: "in",
      duration: 0.5,
    });
    ramp._update(0.25);
    expect(filter.time).toBeCloseTo(0.25, 10);

    trigger();
    expect(filter.time).toBe(0.5);
    expect(ramp.completed).toBe(true);
  });

  it("rejects an unknown shockwave direction", () => {
    expect(() =>
      shockwave({ direction: "sideways" as ShockwaveDirection })(),
    ).toThrow(/direction/);
  });
});
