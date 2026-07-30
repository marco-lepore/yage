import { describe, expect, it } from "vitest";
import { synthPresets } from "./presets.js";
import { renderSynthSound, SYNTH_SAMPLE_RATE } from "./render.js";
import type { SynthPatch } from "./types.js";

const names = Object.keys(synthPresets) as Array<keyof typeof synthPresets>;

function stats(samples: Float32Array): { peak: number; rms: number } {
  let peak = 0;
  let sum = 0;
  for (const value of samples) {
    peak = Math.max(peak, Math.abs(value));
    sum += value * value;
  }
  return { peak, rms: Math.sqrt(sum / samples.length) };
}

describe("synthPresets", () => {
  it.each(names)("%s renders audible samples that never clip", (name) => {
    const { peak, rms } = stats(renderSynthSound(synthPresets[name]()));
    expect(peak).toBeGreaterThan(0.02);
    expect(peak).toBeLessThan(1);
    // Loud enough to hear next to the others, quiet enough to layer.
    expect(rms).toBeGreaterThan(0.005);
    expect(rms).toBeLessThan(0.15);
  });

  it.each(names)("%s takes a volume override", (name) => {
    const loud = stats(renderSynthSound(synthPresets[name]({ volume: 0.5 })));
    const quiet = stats(renderSynthSound(synthPresets[name]({ volume: 0.05 })));
    expect(quiet.rms).toBeLessThan(loud.rms);
  });

  it("takes a duration override on a single-voice preset", () => {
    const samples = renderSynthSound(synthPresets.hit({ duration: 0.5 }));
    expect(samples).toHaveLength(0.5 * SYNTH_SAMPLE_RATE);
  });

  it("takes a duration override on a jingle as the per-note length", () => {
    const samples = renderSynthSound(synthPresets.victory({ duration: 0.05 }));
    // Four notes, still spaced by the preset's noteSpacing of 0.12s.
    expect(samples).toHaveLength((0.12 * 3 + 0.05) * SYNTH_SAMPLE_RATE);
  });

  it("applies overrides to a stack's lead voice only, so the layers keep their shape", () => {
    const stack = synthPresets.shoot({ frequency: 300 }) as readonly SynthPatch[];
    expect(stack[0]?.frequency).toBe(300);
    expect(stack[1]?.wave).toBe("noise");
    expect(stack[1]?.volume).toBe(synthPresets.shoot()[1]?.volume);
  });

  it("gives each footstep surface its own filter at a matched level", () => {
    const stone = stats(renderSynthSound(synthPresets.footstep()));
    const grass = stats(
      renderSynthSound(synthPresets.footstep({ surface: "grass" })),
    );
    expect(grass.peak).toBeLessThan(1);
    expect(grass.peak).toBeGreaterThan(stone.peak * 0.5);
    expect(grass.peak).toBeLessThan(stone.peak * 2);
  });

  it("renders the room tone loop-clean and long", () => {
    const samples = renderSynthSound(synthPresets.roomTone());
    expect(samples.length).toBeGreaterThan(2 * SYNTH_SAMPLE_RATE);
    expect(Math.abs((samples.at(-1) ?? 0) - (samples[0] ?? 0))).toBeLessThan(0.01);
  });

  it("renders wind loop-clean, with the gusts decayed before the loop point", () => {
    const samples = renderSynthSound(synthPresets.wind());
    expect(samples.length).toBeGreaterThan(5 * SYNTH_SAMPLE_RATE);
    // The bed sits in a higher band than room tone, so adjacent samples move
    // more — the wrap step just has to stay inaudibly small.
    expect(Math.abs((samples.at(-1) ?? 0) - (samples[0] ?? 0))).toBeLessThan(0.05);
  });

  it("speaks the same dialogue-beeps phrase per seed and ends on the pad slot", () => {
    const a = renderSynthSound(synthPresets.dialogueBeeps());
    const b = renderSynthSound(synthPresets.dialogueBeeps());
    const other = renderSynthSound(synthPresets.dialogueBeeps({ seed: 9 }));
    expect(a).toEqual(b);
    expect(other).not.toEqual(a);
    // The trailing silent note pads the loop, so the buffer ends at zero.
    expect(Math.abs(a.at(-1) ?? 0)).toBe(0);
  });
});
