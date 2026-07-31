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

  it("takes noteDuration and noteSpacing on a jingle", () => {
    const samples = renderSynthSound(
      synthPresets.victory({ noteDuration: 0.05 }),
    );
    // Four notes, still spaced by the preset's noteSpacing of 0.12s.
    expect(samples).toHaveLength((0.12 * 3 + 0.05) * SYNTH_SAMPLE_RATE);
    const spaced = renderSynthSound(
      synthPresets.victory({ noteDuration: 0.05, noteSpacing: 0.2 }),
    );
    expect(spaced).toHaveLength(Math.round((0.2 * 3 + 0.05) * SYNTH_SAMPLE_RATE));
  });

  it("scales every voice of a layered preset with gain, not just the lead", () => {
    const stack = synthPresets.shoot({ gain: 0.5 });
    const plain = synthPresets.shoot();
    expect(stack[0]?.volume).toBeCloseTo((plain[0]?.volume ?? 0) * 0.5);
    expect(stack[1]?.volume).toBeCloseTo((plain[1]?.volume ?? 0) * 0.5);
  });

  it("gain reaches a footstep's tail voice and a jingle's shared voice", () => {
    const grass = synthPresets.footstep({ surface: "grass", gain: 0.5 });
    const plainGrass = synthPresets.footstep({ surface: "grass" });
    expect(grass).toHaveLength(2);
    expect((grass as SynthPatch[])[1]?.volume).toBeCloseTo(
      ((plainGrass as SynthPatch[])[1]?.volume ?? 0) * 0.5,
    );
    const jingle = synthPresets.victory({ gain: 0.5 });
    expect(jingle.voice?.volume).toBeCloseTo(
      (synthPresets.victory().voice?.volume ?? 0) * 0.5,
    );
  });

  it("leaves the preset untouched when called again", () => {
    // The helpers copy, so an override can't leak into the next call.
    synthPresets.shoot({ frequency: 50, gain: 0.1 });
    expect(synthPresets.shoot()[0]?.frequency).toBe(720);
  });

  it("hands out footstep filters a caller can edit without changing later steps", () => {
    // The surface table is a module constant, so its nested filters have to
    // be copied out, not shared.
    const grass = synthPresets.footstep({ surface: "grass" }) as SynthPatch[];
    const leadFilter = grass[0]?.filter;
    const tailFilter = grass[1]?.filter;
    if (leadFilter) leadFilter.frequency = 99;
    if (tailFilter) tailFilter.frequency = 99;
    const next = synthPresets.footstep({ surface: "grass" }) as SynthPatch[];
    expect(next[0]?.filter?.frequency).toBe(1200);
    expect(next[1]?.filter?.frequency).toBe(2000);
  });

  it("rejects a gain that isn't a finite level", () => {
    expect(() => synthPresets.hit({ gain: -1 })).toThrowError(/gain/);
    // -0 volume slips past the renderer's own check, so gain is validated here.
    expect(() => synthPresets.hit({ volume: 0, gain: -1 })).toThrowError(/gain/);
    expect(() => synthPresets.victory({ gain: Number.NaN })).toThrowError(/gain/);
  });

  it("keeps the dialogue phrase seed separate from the voice's noise seed", () => {
    const a = renderSynthSound(synthPresets.dialogueBeeps({ phraseSeed: 4 }));
    const b = renderSynthSound(synthPresets.dialogueBeeps({ phraseSeed: 4 }));
    const other = renderSynthSound(synthPresets.dialogueBeeps({ phraseSeed: 9 }));
    expect(a).toEqual(b);
    expect(other).not.toEqual(a);
    // `seed` still means the voice's noise seed, and reaches it.
    expect(synthPresets.dialogueBeeps({ seed: 7 }).voice?.seed).toBe(7);
  });

  it("rejects a dialogue base pitch that would render only rests", () => {
    expect(() => synthPresets.dialogueBeeps({ frequency: 0 })).toThrowError(
      /frequency/,
    );
  });

  it("applies overrides to a stack's lead voice only, so the layers keep their shape", () => {
    const stack = synthPresets.shoot({ frequency: 300 });
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
    const other = renderSynthSound(synthPresets.dialogueBeeps({ phraseSeed: 9 }));
    expect(a).toEqual(b);
    expect(other).not.toEqual(a);
    // The trailing silent note pads the loop, so the buffer ends at zero.
    expect(Math.abs(a.at(-1) ?? 0)).toBe(0);
  });
});
