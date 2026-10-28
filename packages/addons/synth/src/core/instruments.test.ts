import { parseSynthSound } from "./parse.js";
import { renderSynthSample } from "./sample.js";
import { it, expect } from "vitest";
import { renderSynthInstrument } from "./instruments.js";
import { synthInstruments } from "../instruments.js";
it.each(Object.keys(synthInstruments) as Array<keyof typeof synthInstruments>)(
  "renders finite, reproducible %s with useful level",
  (name) => {
    const a = renderSynthInstrument(
      synthInstruments[name].sound({ seed: 24 }),
      16000,
      synthInstruments,
    );
    const b = renderSynthInstrument(
      synthInstruments[name].sound({ seed: 24 }),
      16000,
      synthInstruments,
    );
    expect(a.samples).toEqual(b.samples);
    expect(a).toEqual(synthInstruments[name].render({ seed: 24 }, 16000));
    expect(a.samples.every(Number.isFinite)).toBe(true);
    let peak = 0;
    for (const v of a.samples) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.01);
    expect(peak).toBeLessThanOrEqual(0.31);
    if (a.loopStart !== undefined) {
      expect(a.loopStart).toBeLessThan(a.loopEnd!);
      expect(a.loopEnd).toBeLessThanOrEqual(a.samples.length / a.sampleRate);
    }
  },
);
it("rejects invalid instrument inputs before allocating samples", () => {
  for (const options of [
    { frequency: NaN },
    { frequency: 0 },
    { volume: Infinity },
    { seed: -1 },
  ])
    expect(() => synthInstruments.pad.render(options)).toThrow();
});
it("changes noisy timbre with the explicit seed", () => {
  expect(synthInstruments.banjo.render({ seed: 1 }, 8000).samples).not.toEqual(
    synthInstruments.banjo.render({ seed: 2 }, 8000).samples,
  );
});

it("uses the supplied instrument set for parsing and generic sample rendering", () => {
  const flute = synthInstruments.flute;
  const sound = parseSynthSound({ instrument: "flute", seed: 24 }, { flute });
  expect(renderSynthSample(sound, 8000, { flute })).toEqual(
    flute.render({ seed: 24 }, 8000),
  );
  expect(() => renderSynthSample(sound)).toThrow('"flute" is not registered');
  expect(() => parseSynthSound({ instrument: "banjo" }, { flute })).toThrow();
});

it("reports the root note of pitched instruments only", () => {
  expect(synthInstruments.flute.render({}, 8000).rootNote).toBe(60);
  expect(
    synthInstruments.bass.render({ frequency: 130.812783 }, 8000).rootNote,
  ).toBe(48);
  expect(synthInstruments.kick.render({}, 8000).rootNote).toBeUndefined();
  expect(synthInstruments.kick.pitched).toBe(false);
});
