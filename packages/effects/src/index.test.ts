import { describe, it, expect } from "vitest";
import {
  hitFlash,
  bloom,
  outline,
  dropShadow,
  pixelate,
  glow,
  crt,
  chromaticAberration,
  vignette,
  colorGrade,
  godRay,
  shockwave,
  motionBlur,
  oldFilm,
  bulgePinch,
  halftone,
  wave,
  colorize,
  glitch,
  zoomBlur,
  axisBlur,
  implosion,
} from "./index.js";

// Smoke tests live here. End-to-end attach + serialize round-trip is
// covered by `@yagejs/renderer`'s EffectStack tests using a fake filter,
// because pixi's real filter constructors require a WebGL context that
// jsdom/happy-dom don't provide.

describe("@yagejs/effects presets", () => {
  it("each preset registers a unique non-empty yage: name", () => {
    const names = new Set<string>();
    for (const preset of [
      hitFlash,
      bloom,
      outline,
      dropShadow,
      pixelate,
      glow,
      crt,
      chromaticAberration,
      vignette,
      colorGrade,
      godRay,
      shockwave,
      motionBlur,
      oldFilm,
      bulgePinch,
      halftone,
      wave,
      colorize,
      glitch,
      zoomBlur,
      axisBlur,
      implosion,
    ]) {
      expect(preset.name).toMatch(/^yage:/);
      names.add(preset.name);
    }
    expect(names.size).toBe(22);
  });

  it("calling a preset with options returns a callable factory", () => {
    expect(typeof hitFlash({ color: 0xffffff })).toBe("function");
    expect(typeof bloom({ bloomScale: 1.5 })).toBe("function");
    expect(typeof colorGrade({ preset: "sepia" })).toBe("function");
    expect(typeof godRay({ angle: 45 })).toBe("function");
    expect(typeof shockwave({ amplitude: 20 })).toBe("function");
    expect(typeof motionBlur({ velocity: { x: 30, y: 0 } })).toBe("function");
    expect(typeof oldFilm({ sepia: 0.5 })).toBe("function");
    expect(typeof bulgePinch({ strength: 0.5 })).toBe("function");
    expect(typeof halftone({ size: 6 })).toBe("function");
    expect(typeof wave({ amplitude: 6 })).toBe("function");
    expect(typeof colorize({ color: 0xf2c14e })).toBe("function");
    expect(typeof glitch({ slices: 6 })).toBe("function");
    expect(typeof zoomBlur({ strength: 0.15 })).toBe("function");
    expect(typeof axisBlur({ axis: "vertical" })).toBe("function");
    expect(typeof implosion({ radius: 160 })).toBe("function");
  });
});
