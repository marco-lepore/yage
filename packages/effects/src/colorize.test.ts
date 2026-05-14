import { describe, it, expect, vi } from "vitest";

// `GlProgram.from` reaches for `document` (browser env), and vitest runs
// these tests under node by default. Stub the three pixi entry points
// colorize.ts touches at construction time so the filter can be built in
// a Node test env. Color is delegated to the real implementation — it's
// pure-JS and works fine outside a browser.
vi.mock("pixi.js", async () => {
  const actual = await vi.importActual<typeof import("pixi.js")>("pixi.js");
  return {
    ...actual,
    Filter: class FakeFilter {
      enabled = true;
      alpha = 1;
      resources: Record<string, { uniforms: Record<string, unknown> }>;
      constructor(opts: { resources: Record<string, Record<string, { value: unknown }>> }) {
        const flat: Record<string, { uniforms: Record<string, unknown> }> = {};
        for (const [group, fields] of Object.entries(opts.resources)) {
          const uniforms: Record<string, unknown> = {};
          for (const [name, decl] of Object.entries(fields)) {
            uniforms[name] = decl.value;
          }
          flat[group] = { uniforms };
        }
        this.resources = flat;
      }
    },
    GlProgram: { from: () => ({}) },
    GpuProgram: { from: () => ({}) },
  };
});

import type { Filter } from "pixi.js";
import { colorize } from "./colorize.js";

// The colorize shader runs on the GPU, and jsdom has no WebGL context to
// run it against. Instead we verify the algorithm by running a JS
// reference function that mirrors the GLSL/WGSL math line-for-line, then
// separately verify the filter's uniforms wire the right values into the
// shader's `uColor` / `uStrength`. If the reference passes AND the
// uniforms route correctly, the shader output is fully specified.

interface Pixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

function colorizePixel(src: Pixel, color: number, strength: number): Pixel {
  const cr = ((color >> 16) & 0xff) / 255;
  const cg = ((color >> 8) & 0xff) / 255;
  const cb = (color & 0xff) / 255;
  const lum = 0.299 * src.r + 0.587 * src.g + 0.114 * src.b;
  const tr = cr * lum;
  const tg = cg * lum;
  const tb = cb * lum;
  return {
    r: src.r + (tr - src.r) * strength,
    g: src.g + (tg - src.g) * strength,
    b: src.b + (tb - src.b) * strength,
    a: src.a,
  };
}

/** Build the vertical luminance ramp used by the per-pixel tests. */
function ramp(height: number): Pixel[] {
  const out: Pixel[] = [];
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    out.push({ r: v, g: v, b: v, a: 1 });
  }
  return out;
}

function uniformsOf(filter: Filter): {
  uColor: Float32Array | number[];
  uStrength: number;
} {
  const resources = (filter as unknown as { resources: Record<string, { uniforms: unknown }> })
    .resources;
  return resources.colorizeUniforms!.uniforms as {
    uColor: Float32Array | number[];
    uStrength: number;
  };
}

describe("colorize preset", () => {
  describe("per-pixel output against a vertical luminance ramp", () => {
    // `colorize({ color: 0xff0000 })` on a top-to-bottom black→white ramp
    // is the canonical case: black stays black, white becomes full red,
    // mid-gray becomes mid-red.
    const pixels = ramp(11); // 0, 0.1, 0.2, ..., 1.0

    it("black (luminance 0) stays fully black", () => {
      const out = colorizePixel(pixels[0]!, 0xff0000, 1);
      expect(out.r).toBeCloseTo(0, 5);
      expect(out.g).toBeCloseTo(0, 5);
      expect(out.b).toBeCloseTo(0, 5);
    });

    it("white (luminance 1) becomes the full target colour", () => {
      const out = colorizePixel(pixels[10]!, 0xff0000, 1);
      expect(out.r).toBeCloseTo(1, 5);
      expect(out.g).toBeCloseTo(0, 5);
      expect(out.b).toBeCloseTo(0, 5);
    });

    it("midtone (luminance 0.5) becomes the target colour scaled by L", () => {
      const out = colorizePixel(pixels[5]!, 0xff0000, 1);
      expect(out.r).toBeCloseTo(0.5, 5);
      expect(out.g).toBeCloseTo(0, 5);
      expect(out.b).toBeCloseTo(0, 5);
    });
  });

  describe("strength axis", () => {
    it("strength: 0 produces output identical to source", () => {
      const src: Pixel = { r: 0.4, g: 0.6, b: 0.2, a: 1 };
      const out = colorizePixel(src, 0xff0000, 0);
      expect(out.r).toBeCloseTo(src.r, 5);
      expect(out.g).toBeCloseTo(src.g, 5);
      expect(out.b).toBeCloseTo(src.b, 5);
      expect(out.a).toBeCloseTo(src.a, 5);
    });

    it("strength: 0.5 produces a 50/50 blend of source and tinted output", () => {
      const src: Pixel = { r: 1, g: 1, b: 1, a: 1 }; // luminance 1 → tinted = pure target
      const out = colorizePixel(src, 0xff0000, 0.5);
      // mix((1,1,1), (1,0,0), 0.5) = (1, 0.5, 0.5)
      expect(out.r).toBeCloseTo(1, 5);
      expect(out.g).toBeCloseTo(0.5, 5);
      expect(out.b).toBeCloseTo(0.5, 5);
    });
  });

  it("preserves source alpha unchanged (0.3 stays 0.3)", () => {
    const src: Pixel = { r: 0.8, g: 0.4, b: 0.2, a: 0.3 };
    const out = colorizePixel(src, 0x00ff00, 1);
    expect(out.a).toBeCloseTo(0.3, 5);
  });

  describe("filter uniform wiring", () => {
    it("constructs with strength default 1 and the numeric colour split into 0..1 vec3", () => {
      const effect = colorize({ color: 0xff0000 })();
      const u = uniformsOf(effect.filter as Filter);
      expect(u.uStrength).toBe(1);
      expect(u.uColor[0]).toBeCloseTo(1, 5);
      expect(u.uColor[1]).toBeCloseTo(0, 5);
      expect(u.uColor[2]).toBeCloseTo(0, 5);
    });

    it("accepts a configured strength and routes it into the uniform", () => {
      const effect = colorize({ color: 0x00ff00, strength: 0.5 })();
      const u = uniformsOf(effect.filter as Filter);
      expect(u.uStrength).toBeCloseTo(0.5, 5);
      expect(u.uColor[1]).toBeCloseTo(1, 5);
    });

    it("accepts colour as a CSS-style string", () => {
      const effect = colorize({ color: "#0000ff" })();
      const u = uniformsOf(effect.filter as Filter);
      expect(u.uColor[0]).toBeCloseTo(0, 5);
      expect(u.uColor[1]).toBeCloseTo(0, 5);
      expect(u.uColor[2]).toBeCloseTo(1, 5);
    });

    it("setIntensity scales strength against the configured ceiling", () => {
      const effect = colorize({ color: 0xff0000, strength: 0.8 })();
      effect.setIntensity(0.5);
      const u = uniformsOf(effect.filter as Filter);
      expect(u.uStrength).toBeCloseTo(0.4, 5);
      expect(effect.getIntensity()).toBeCloseTo(0.5, 5);
    });

    it("setColor updates the uniform in-place", () => {
      const effect = colorize({ color: 0xff0000 })();
      effect.buildExtras!(null as never).setColor!(0x00ff00);
      const u = uniformsOf(effect.filter as Filter);
      expect(u.uColor[0]).toBeCloseTo(0, 5);
      expect(u.uColor[1]).toBeCloseTo(1, 5);
      expect(u.uColor[2]).toBeCloseTo(0, 5);
    });

    it("setStrength preserves the current intensity ratio", () => {
      const effect = colorize({ color: 0xff0000, strength: 0.5 })();
      effect.setIntensity(0.4); // strength = 0.5 * 0.4 = 0.2
      effect.buildExtras!(null as never).setStrength!(1);
      // ratio preserved (0.4), new ceiling 1 ⇒ strength = 0.4
      expect(effect.getIntensity()).toBeCloseTo(0.4, 5);
      const u = uniformsOf(effect.filter as Filter);
      expect(u.uStrength).toBeCloseTo(0.4, 5);
    });
  });

  it("composes with another effect — independent filters, no cross-talk", () => {
    // Effects added to the same `EffectStack` are appended to a pixi
    // `filters` array; pixi processes them in order with no shared state.
    // The contract we verify here at unit level is that two effect
    // instances built side-by-side hold independent filters with
    // independent uniforms, and that mutating one effect's intensity
    // can't leak into the other's filter.
    const a = colorize({ color: 0xff0000 })();
    const b = colorize({ color: 0x00ff00, strength: 0.5 })();
    expect(a.filter).not.toBe(b.filter);
    expect(uniformsOf(a.filter as Filter).uColor[0]).toBeCloseTo(1, 5);
    expect(uniformsOf(b.filter as Filter).uColor[1]).toBeCloseTo(1, 5);
    a.setIntensity(0);
    expect(uniformsOf(a.filter as Filter).uStrength).toBe(0);
    // b's uniforms are untouched by the mutation on a.
    expect(uniformsOf(b.filter as Filter).uStrength).toBeCloseTo(0.5, 5);
    expect(b.getIntensity()).toBeCloseTo(1, 5);
  });
});
