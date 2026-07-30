import { describe, expect, it } from "vitest";
import { synthPresets } from "./presets.js";
import { renderSynthSound } from "./render.js";
import type { SynthJingle, SynthPatch } from "./types.js";
import { synthVariantAliases, synthVariants } from "./variants.js";

describe("synthVariants", () => {
  it("detunes tonal patches that rely on the default frequency", () => {
    const takes = synthVariants("blip", { wave: "square" }, 3);
    const first = takes[0]?.sound as SynthPatch;
    const last = takes[2]?.sound as SynthPatch;
    expect(first.frequency).toBeLessThan(440);
    expect(last.frequency).toBeGreaterThan(440);
  });

  it("rejects non-integer or non-positive counts", () => {
    expect(() => synthVariants("x", {}, 2.5)).toThrowError(/count/);
    expect(() => synthVariants("x", {}, 0)).toThrowError(/count/);
    expect(() => synthVariants("x", {}, Infinity)).toThrowError(/count/);
    expect(() => synthVariantAliases("x", 2.5)).toThrowError(/count/);
  });

  it("names the takes alias.1 … alias.n", () => {
    expect(synthVariants("shoot", { frequency: 400 }, 3).map((v) => v.alias)).toEqual([
      "shoot.1",
      "shoot.2",
      "shoot.3",
    ]);
    expect(synthVariantAliases("shoot", 3)).toEqual([
      "shoot.1",
      "shoot.2",
      "shoot.3",
    ]);
  });

  it("spreads the pitch evenly across ±detune", () => {
    const takes = synthVariants("s", { frequency: 1000, glideTo: 500 }, 3, 0.1);
    const pitches = takes.map((t) => (t.sound as SynthPatch).frequency);
    expect(pitches).toEqual([900, 1000, 1100]);
    expect((takes[0]?.sound as SynthPatch).glideTo).toBe(450);
  });

  it("leaves a single take at the original pitch", () => {
    const [only] = synthVariants("s", { frequency: 440 }, 1);
    expect((only?.sound as SynthPatch).frequency).toBe(440);
  });

  it("gives each take its own noise", () => {
    const takes = synthVariants("s", { wave: "noise", duration: 0.05 }, 2);
    const [first, second] = takes.map((t) => renderSynthSound(t.sound));
    expect(first).not.toEqual(second);
  });

  it("shifts every voice of a stack and every note of a jingle", () => {
    const stack = synthVariants("s", synthPresets.hurt(), 2, 0.5)[0]
      ?.sound as readonly SynthPatch[];
    expect(stack[0]?.frequency).toBe(220 * 0.5);
    expect(stack[1]?.frequency).toBe(160 * 0.5);

    const jingle = synthVariants("s", synthPresets.victory(), 2, 0.5)[0]
      ?.sound as SynthJingle;
    expect(jingle.notes).toEqual([523 * 0.5, 659 * 0.5, 784 * 0.5, 1046 * 0.5]);
  });
});
