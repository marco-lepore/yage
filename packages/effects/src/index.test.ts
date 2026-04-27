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
    ]) {
      expect(preset.name).toMatch(/^yage:/);
      names.add(preset.name);
    }
    expect(names.size).toBe(10);
  });

  it("calling a preset with options returns a callable factory", () => {
    expect(typeof hitFlash({ color: 0xffffff })).toBe("function");
    expect(typeof bloom({ bloomScale: 1.5 })).toBe("function");
    expect(typeof colorGrade({ preset: "sepia" })).toBe("function");
  });
});
