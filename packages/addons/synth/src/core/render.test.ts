import { describe, expect, it } from "vitest";
import {
  renderSynthJingle,
  renderSynthPatch,
  renderSynthSound,
  SYNTH_SAMPLE_RATE,
} from "./render.js";
import type { SynthPatch } from "./types.js";

const RATE = SYNTH_SAMPLE_RATE;

function peak(samples: Float32Array): number {
  let max = 0;
  for (const value of samples) max = Math.max(max, Math.abs(value));
  return max;
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (const value of samples) sum += value * value;
  return Math.sqrt(sum / samples.length);
}

/** Zero crossings over a slice — a stand-in for pitch. */
function crossings(samples: Float32Array, from: number, to: number): number {
  let count = 0;
  for (let i = from + 1; i < to; i++) {
    if ((samples[i - 1] ?? 0) < 0 !== ((samples[i] ?? 0) < 0)) count++;
  }
  return count;
}

describe("renderSynthPatch", () => {
  it("renders duration * sampleRate samples", () => {
    expect(renderSynthPatch({ duration: 0.25 }, RATE)).toHaveLength(0.25 * RATE);
    expect(renderSynthPatch({ duration: 0.1 }, 8000)).toHaveLength(800);
  });

  it("prefixes silence for a delayed voice", () => {
    const samples = renderSynthPatch({ duration: 0.1, delay: 0.05 }, RATE);
    expect(samples).toHaveLength(0.15 * RATE);
    expect(peak(samples.slice(0, 0.05 * RATE))).toBe(0);
    expect(peak(samples.slice(0.05 * RATE))).toBeGreaterThan(0);
  });

  it("ramps in over the attack and decays to silence", () => {
    const samples = renderSynthPatch(
      { frequency: 200, duration: 0.4, attack: 0.1, volume: 1 },
      RATE,
    );
    const attackStart = peak(samples.slice(0, 0.02 * RATE));
    const attackEnd = peak(
      samples.slice(0.08 * RATE, Math.round(0.1 * RATE)),
    );
    expect(attackStart).toBeLessThan(attackEnd);
    expect(peak(samples.slice(-64))).toBeLessThan(0.01);
  });

  it("stays within the patch volume", () => {
    expect(peak(renderSynthPatch({ volume: 0.2, duration: 0.2 }, RATE))).toBeLessThanOrEqual(0.2);
  });

  it("is deterministic, and the seed is what changes the noise", () => {
    const patch: SynthPatch = { wave: "noise", duration: 0.05 };
    expect(renderSynthPatch(patch, RATE)).toEqual(renderSynthPatch(patch, RATE));
    expect(renderSynthPatch({ ...patch, seed: 7 }, RATE)).not.toEqual(
      renderSynthPatch(patch, RATE),
    );
  });

  it("glides the pitch down over the sound", () => {
    const samples = renderSynthPatch(
      { frequency: 800, glideTo: 100, duration: 0.4, attack: 0.001, curve: 0 },
      RATE,
    );
    const tenth = samples.length / 10;
    expect(crossings(samples, 0, tenth)).toBeGreaterThan(
      crossings(samples, samples.length - tenth, samples.length) * 3,
    );
  });

  it("filters: a lowpass keeps less of a noise burst than a highpass", () => {
    const base: SynthPatch = { wave: "noise", duration: 0.2, volume: 1 };
    const low = rms(
      renderSynthPatch({ ...base, filter: { type: "lowpass", frequency: 400 } }, RATE),
    );
    const high = rms(
      renderSynthPatch({ ...base, filter: { type: "highpass", frequency: 400 } }, RATE),
    );
    expect(low).toBeLessThan(high);
  });

  it("ends exactly at zero, even when the attack fills the whole voice", () => {
    const decayed = renderSynthPatch(
      { frequency: 200, duration: 0.1, volume: 1 },
      RATE,
    );
    expect(Math.abs(decayed.at(-1) ?? 1)).toBe(0);
    const allAttack = renderSynthPatch(
      { frequency: 200, duration: 0.05, attack: 1, volume: 1 },
      RATE,
    );
    expect(Math.abs(allAttack.at(-1) ?? 1)).toBe(0);
    expect(peak(allAttack)).toBeGreaterThan(0.5); // the ramp still runs
  });

  it("stays finite and bounded with every filter type at the cutoff cap", () => {
    for (const type of ["lowpass", "highpass", "bandpass"] as const) {
      for (const wave of ["noise", "square"] as const) {
        const samples = renderSynthPatch(
          {
            wave,
            frequency: 220,
            duration: 0.25,
            volume: 1,
            filter: { type, frequency: RATE / 3, q: 10 },
          },
          RATE,
        );
        expect(samples.every(Number.isFinite)).toBe(true);
        expect(peak(samples)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("stays finite while a sweep crosses the cutoff cap", () => {
    const samples = renderSynthPatch(
      {
        wave: "noise",
        duration: 0.3,
        volume: 1,
        filter: { type: "lowpass", frequency: 200, sweepTo: RATE, q: 10 },
      },
      RATE,
    );
    expect(samples.every(Number.isFinite)).toBe(true);
  });

  it("clamps the seamless crossfade to [-1, 1]", () => {
    const samples = renderSynthPatch(
      { wave: "square", frequency: 40, duration: 1, volume: 1, seamless: true },
      RATE,
    );
    expect(peak(samples)).toBeLessThanOrEqual(1);
  });

  it("rejects a seamless patch with a delay", () => {
    expect(() =>
      renderSynthPatch(
        { wave: "noise", duration: 1, delay: 0.1, seamless: true },
        RATE,
      ),
    ).toThrowError(/seamless/);
  });

  it("rejects out-of-range numeric fields, naming the field", () => {
    expect(() => renderSynthPatch({ duration: 0 }, RATE)).toThrowError(/duration/);
    expect(() => renderSynthPatch({ duration: Infinity }, RATE)).toThrowError(/duration/);
    expect(() => renderSynthPatch({ frequency: 0 }, RATE)).toThrowError(/frequency/);
    expect(() => renderSynthPatch({ glideTo: -10 }, RATE)).toThrowError(/glideTo/);
    expect(() => renderSynthPatch({ volume: Number.NaN }, RATE)).toThrowError(/volume/);
    expect(() => renderSynthPatch({ noise: 2 }, RATE)).toThrowError(/noise/);
    expect(() => renderSynthPatch({}, 0)).toThrowError(/sampleRate/);
    expect(() =>
      renderSynthPatch({ filter: { type: "lowpass", frequency: Number.NaN } }, RATE),
    ).toThrowError(/filter\.frequency/);
    // "noise" has no pitch, so its frequency fields are ignored, not checked.
    expect(() =>
      renderSynthPatch({ wave: "noise", frequency: 0, duration: 0.01 }, RATE),
    ).not.toThrow();
  });

  it("a seamless patch skips the envelope, loops cleanly, and is shorter by the crossfade", () => {
    const patch: SynthPatch = {
      wave: "noise",
      duration: 1,
      volume: 0.5,
      filter: { type: "lowpass", frequency: 200 },
    };
    const samples = renderSynthPatch({ ...patch, seamless: true }, RATE);
    expect(samples.length).toBeLessThan(RATE);
    // No envelope: the sound is already at level in its first millisecond,
    // where the enveloped version is still ramping in.
    expect(peak(samples.slice(0, 64))).toBeGreaterThan(
      peak(renderSynthPatch(patch, RATE).slice(0, 64)),
    );
    // The loop point: wrapping from the last sample to the first is no
    // bigger a step than the ones inside the buffer.
    let steps = 0;
    for (let i = 1; i < samples.length; i++) {
      steps += Math.abs((samples[i] ?? 0) - (samples[i - 1] ?? 0));
    }
    const meanStep = steps / (samples.length - 1);
    const seamStep = Math.abs((samples.at(-1) ?? 0) - (samples[0] ?? 0));
    expect(seamStep).toBeLessThan(meanStep * 5);
  });
});

describe("renderSynthSound", () => {
  it("layers a stack, honouring each voice's delay", () => {
    const samples = renderSynthSound(
      [
        { frequency: 400, duration: 0.1 },
        { frequency: 200, duration: 0.1, delay: 0.2 },
      ],
      RATE,
    );
    expect(samples).toHaveLength(0.3 * RATE);
    expect(peak(samples.slice(0.12 * RATE, 0.18 * RATE))).toBe(0);
    expect(peak(samples.slice(0.2 * RATE))).toBeGreaterThan(0);
  });

  it("never leaves the [-1, 1] range when layers sum past it", () => {
    const loud: SynthPatch = { frequency: 300, duration: 0.1, volume: 1 };
    expect(peak(renderSynthSound([loud, loud, loud], RATE))).toBeLessThanOrEqual(1);
  });

  it("dispatches a jingle by its notes", () => {
    const sound = { notes: [440, 660], noteDuration: 0.1 };
    expect(renderSynthSound(sound, RATE)).toEqual(renderSynthJingle(sound, RATE));
  });
});

describe("renderSynthJingle", () => {
  it("spaces notes by noteSpacing and ends with the last note", () => {
    const samples = renderSynthJingle(
      { notes: [440, 660, 880], noteDuration: 0.1, noteSpacing: 0.05 },
      RATE,
    );
    expect(samples).toHaveLength((0.05 * 2 + 0.1) * RATE);
  });

  it("leaves a rest silent", () => {
    const samples = renderSynthJingle(
      { notes: [440, 0, 880], noteDuration: 0.1 },
      RATE,
    );
    expect(peak(samples.slice(0.1 * RATE, 0.2 * RATE))).toBe(0);
  });

  it("rejects a bad noteDuration even when every note is a rest", () => {
    expect(() =>
      renderSynthJingle({ notes: [0], noteDuration: Number.NaN }, RATE),
    ).toThrowError(/renderSynthJingle: noteDuration/);
    expect(() =>
      renderSynthJingle(
        { notes: [{ frequency: 0, duration: Number.NaN }] },
        RATE,
      ),
    ).toThrowError(/renderSynthJingle: notes\[0\]\.duration/);
  });

  it("keeps a trailing rest's slot on the timeline", () => {
    const samples = renderSynthJingle(
      { notes: [440, 0], noteDuration: 0.1 },
      RATE,
    );
    expect(samples).toHaveLength(0.2 * RATE);
    expect(peak(samples.slice(0.1 * RATE))).toBe(0);
  });

  it("scales the voice volume per note", () => {
    const samples = renderSynthJingle(
      {
        notes: [{ frequency: 440 }, { frequency: 440, volume: 0.25 }],
        noteDuration: 0.1,
        voice: { volume: 0.8, attack: 0.001 },
      },
      RATE,
    );
    const first = peak(samples.slice(0, 0.1 * RATE));
    const second = peak(samples.slice(0.1 * RATE));
    expect(second).toBeLessThan(first * 0.5);
  });
});
