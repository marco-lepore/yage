import { describe, it, expect, vi } from "vitest";

// pixi-filters constructors require a WebGL context. Mock just enough so the
// preset factories can build their filter and we can drive setIntensity /
// set* through them.
vi.mock("pixi-filters", () => {
  class FakeFilter {
    enabled = true;
    alpha = 1;
  }
  class AdvancedBloomFilter extends FakeFilter {
    threshold: number;
    bloomScale: number;
    brightness: number;
    blur: number;
    quality: number;
    padding = 0;
    constructor(opts: {
      threshold: number;
      bloomScale: number;
      brightness: number;
      blur: number;
      quality: number;
    }) {
      super();
      this.threshold = opts.threshold;
      this.bloomScale = opts.bloomScale;
      this.brightness = opts.brightness;
      this.blur = opts.blur;
      this.quality = opts.quality;
    }
  }
  class CRTFilter extends FakeFilter {
    curvature: number;
    lineWidth: number;
    lineContrast: number;
    verticalLine: boolean;
    noise: number;
    vignetting: number;
    vignettingAlpha: number;
    vignettingBlur = 0.3;
    time = 0;
    seed = 0;
    constructor(opts: {
      curvature: number;
      lineWidth: number;
      lineContrast: number;
      verticalLine: boolean;
      noise: number;
      vignetting: number;
      vignettingAlpha: number;
      vignettingBlur?: number;
    }) {
      super();
      this.curvature = opts.curvature;
      this.lineWidth = opts.lineWidth;
      this.lineContrast = opts.lineContrast;
      this.verticalLine = opts.verticalLine;
      this.noise = opts.noise;
      this.vignetting = opts.vignetting;
      this.vignettingAlpha = opts.vignettingAlpha;
      if (opts.vignettingBlur !== undefined) {
        this.vignettingBlur = opts.vignettingBlur;
      }
    }
  }
  class GlowFilter extends FakeFilter {
    color: number;
    distance: number;
    outerStrength: number;
    innerStrength: number;
    quality: number;
    knockout: boolean;
    padding = 0;
    constructor(opts: {
      color: number;
      distance: number;
      outerStrength: number;
      innerStrength: number;
      alpha: number;
      quality: number;
      knockout: boolean;
    }) {
      super();
      this.color = opts.color;
      this.distance = opts.distance;
      this.outerStrength = opts.outerStrength;
      this.innerStrength = opts.innerStrength;
      this.alpha = opts.alpha;
      this.quality = opts.quality;
      this.knockout = opts.knockout;
    }
  }
  class OutlineFilter extends FakeFilter {
    thickness: number;
    color: number;
    quality: number;
    knockout: boolean;
    padding = 0;
    constructor(opts: {
      thickness: number;
      color: number;
      alpha: number;
      quality: number;
      knockout: boolean;
    }) {
      super();
      this.thickness = opts.thickness;
      this.color = opts.color;
      this.alpha = opts.alpha;
      this.quality = opts.quality;
      this.knockout = opts.knockout;
    }
  }
  class DropShadowFilter extends FakeFilter {
    offset: { x: number; y: number };
    color: number;
    blur: number;
    quality: number;
    shadowOnly: boolean;
    padding = 0;
    constructor(opts: {
      offset: { x: number; y: number };
      color: number;
      alpha: number;
      blur: number;
      quality: number;
      shadowOnly: boolean;
    }) {
      super();
      this.offset = opts.offset;
      this.color = opts.color;
      this.alpha = opts.alpha;
      this.blur = opts.blur;
      this.quality = opts.quality;
      this.shadowOnly = opts.shadowOnly;
    }
  }
  class PixelateFilter extends FakeFilter {
    sizeX: number;
    sizeY: number;
    constructor(size: number) {
      super();
      this.sizeX = size;
      this.sizeY = size;
    }
    set size(v: number) {
      this.sizeX = v;
      this.sizeY = v;
    }
    get size(): number {
      return this.sizeX;
    }
  }
  class RGBSplitFilter extends FakeFilter {
    red: { x: number; y: number };
    green: { x: number; y: number };
    blue: { x: number; y: number };
    constructor(opts: {
      red: { x: number; y: number };
      green: { x: number; y: number };
      blue: { x: number; y: number };
    }) {
      super();
      this.red = opts.red;
      this.green = opts.green;
      this.blue = opts.blue;
    }
  }
  return {
    AdvancedBloomFilter,
    CRTFilter,
    GlowFilter,
    OutlineFilter,
    DropShadowFilter,
    PixelateFilter,
    RGBSplitFilter,
  };
});

vi.mock("pixi.js", async () => {
  const actual = await vi.importActual<typeof import("pixi.js")>("pixi.js");
  return {
    ...actual,
    ColorMatrixFilter: class {
      enabled = true;
      alpha = 1;
      matrix = new Array(20).fill(0);
      reset(): void {
        this.matrix = new Array(20).fill(0);
      }
    },
  };
});

import { bloom } from "./bloom.js";
import { chromaticAberration } from "./chromaticAberration.js";
import { crt } from "./crt.js";
import { dropShadow } from "./dropShadow.js";
import { glow } from "./glow.js";
import { outline } from "./outline.js";
import { pixelate } from "./pixelate.js";
import { vignette } from "./vignette.js";

// Each preset is a defineEffect-wrapped factory of options → EffectFactory.
// Calling it with options gives us a zero-arg factory; call that to get the
// raw Effect.
function buildBloom(options: Parameters<typeof bloom>[0] = {}) {
  return bloom(options)();
}
function buildCrt(options: Parameters<typeof crt>[0] = {}) {
  return crt(options)();
}
function buildGlow(options: Parameters<typeof glow>[0] = {}) {
  return glow(options)();
}
function buildOutline(options: Parameters<typeof outline>[0] = {}) {
  return outline(options)();
}
function buildDropShadow(options: Parameters<typeof dropShadow>[0] = {}) {
  return dropShadow(options)();
}
function buildPixelate(options: Parameters<typeof pixelate>[0] = {}) {
  return pixelate(options)();
}
function buildVignette(options: Parameters<typeof vignette>[0] = {}) {
  return vignette(options)();
}
function buildCa(options: Parameters<typeof chromaticAberration>[0] = {}) {
  return chromaticAberration(options)();
}

describe("intensity model", () => {
  describe("CRT routes through filter.alpha", () => {
    it("setIntensity(0) makes filter.alpha 0", () => {
      const e = buildCrt({ lineContrast: 0.3 });
      e.setIntensity(0);
      const f = e.filter as unknown as { alpha: number };
      expect(f.alpha).toBe(0);
    });

    it("setIntensity(0.5) makes filter.alpha 0.5", () => {
      const e = buildCrt({ lineContrast: 0.3 });
      e.setIntensity(0.5);
      const f = e.filter as unknown as { alpha: number };
      expect(f.alpha).toBe(0.5);
    });

    it("setIntensity clamps to [0, 1]", () => {
      const e = buildCrt();
      e.setIntensity(1.5);
      expect((e.filter as unknown as { alpha: number }).alpha).toBe(1);
      e.setIntensity(-0.2);
      expect((e.filter as unknown as { alpha: number }).alpha).toBe(0);
    });
  });

  describe("glow uses compound intensity", () => {
    it("setIntensity(0.5) scales BOTH outerStrength AND innerStrength to half", () => {
      const e = buildGlow({ outerStrength: 4, innerStrength: 2 });
      e.setIntensity(0.5);
      const f = e.filter as unknown as { outerStrength: number; innerStrength: number };
      expect(f.outerStrength).toBe(2);
      expect(f.innerStrength).toBe(1);
    });

    it("setIntensity(0) zeroes both strengths so no halo is visible", () => {
      const e = buildGlow({ outerStrength: 4, innerStrength: 2 });
      e.setIntensity(0);
      const f = e.filter as unknown as { outerStrength: number; innerStrength: number };
      expect(f.outerStrength).toBe(0);
      expect(f.innerStrength).toBe(0);
    });

    it("setOuterStrength preserves the current intensity ratio", () => {
      const e = buildGlow({ outerStrength: 4, innerStrength: 2 });
      e.setIntensity(0.5);
      // mid-pulse "ceiling raise"
      e.buildExtras!(null as never).setOuterStrength!(8);
      // intensity should still report ~0.5 (ratio preserved)
      expect(e.getIntensity()).toBeCloseTo(0.5, 5);
      const f = e.filter as unknown as { outerStrength: number };
      // 8 * 0.5 = 4
      expect(f.outerStrength).toBeCloseTo(4, 5);
    });
  });

  describe("preserve-ratio setters", () => {
    it("bloom.setBloomScale preserves intensity ratio", () => {
      const e = buildBloom({ bloomScale: 1 });
      e.setIntensity(0.4);
      e.buildExtras!(null as never).setBloomScale!(2);
      expect(e.getIntensity()).toBeCloseTo(0.4, 5);
      expect((e.filter as unknown as { bloomScale: number }).bloomScale).toBeCloseTo(0.8, 5);
    });

    it("vignette.setStrength preserves intensity ratio", () => {
      const e = buildVignette({ alpha: 0.6 });
      e.setIntensity(0.5);
      e.buildExtras!(null as never).setStrength!(0.3);
      expect(e.getIntensity()).toBeCloseTo(0.5, 5);
      expect((e.filter as unknown as { vignettingAlpha: number }).vignettingAlpha).toBeCloseTo(
        0.15,
        5,
      );
    });

    it("outline.setThickness preserves intensity ratio", () => {
      const e = buildOutline({ thickness: 4 });
      e.setIntensity(0.25);
      e.buildExtras!(null as never).setThickness!(8);
      expect(e.getIntensity()).toBeCloseTo(0.25, 5);
      expect((e.filter as unknown as { thickness: number }).thickness).toBeCloseTo(2, 5);
    });

    it("dropShadow.setAlpha preserves intensity ratio", () => {
      const e = buildDropShadow({ alpha: 0.5 });
      e.setIntensity(0.4);
      e.buildExtras!(null as never).setAlpha!(1);
      expect(e.getIntensity()).toBeCloseTo(0.4, 5);
      expect((e.filter as unknown as { alpha: number }).alpha).toBeCloseTo(0.4, 5);
    });

    it("chromaticAberration.setSeparation preserves intensity ratio", () => {
      const e = buildCa({ separation: 4 });
      e.setIntensity(0.5);
      e.buildExtras!(null as never).setSeparation!(8);
      expect(e.getIntensity()).toBeCloseTo(0.5, 5);
      const f = e.filter as unknown as { red: { x: number } };
      // 8 * 0.5 = 4 → red.x = -4
      expect(f.red.x).toBeCloseTo(-4, 5);
    });

    it("pixelate.setSize preserves intensity ratio AND clamps live size to ≥1", () => {
      const e = buildPixelate({ size: 8 });
      e.setIntensity(0.5);
      e.buildExtras!(null as never).setSize!(20);
      // Ratio preserved: live size ~ 20 * 0.5 = 10
      expect(e.getIntensity()).toBeCloseTo(0.5, 5);
      expect((e.filter as unknown as { sizeX: number }).sizeX).toBe(10);
      // Now drop to setIntensity(0): clamp kicks in (size=1 minimum)
      e.setIntensity(0);
      expect((e.filter as unknown as { sizeX: number }).sizeX).toBe(1);
    });
  });
});
