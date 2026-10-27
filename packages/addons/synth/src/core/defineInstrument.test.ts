import { describe, expect, expectTypeOf, it } from "vitest";
import { harp, hat, reed } from "../test-helpers.js";
import {
  biquad,
  dcBlock,
  defineInstrument,
  fadeIn,
  fadeOut,
  limit,
  normalize,
  parseSynthSound,
  prepareTonalLoop,
  renderAdditive,
  renderMetal,
  renderModal,
  renderNoise,
  renderString,
  renderSynthSample,
  saturate,
  seededRandom,
  svf,
} from "../render.js";
import { flute, tom } from "../instruments.js";

describe("a custom instrument", () => {
  it("names its descriptor and types it to that name", () => {
    expect(harp.sound({ seed: 3 })).toEqual({ seed: 3, instrument: "harp" });
    expectTypeOf(harp.sound().instrument).toEqualTypeOf<"harp">();
  });

  it("renders with the same bounds, gain and pitch rules as a built-in", () => {
    const sample = harp.render({ frequency: 440, seed: 2, volume: 0.5 }, 8000);
    expect(sample.rootNote).toBe(69);
    expect(sample.loopStart).toBeUndefined();
    const peak = sample.samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeGreaterThan(0.3);
    expect(peak).toBeLessThanOrEqual(0.5);
    for (const options of [{ frequency: 10 }, { seed: -1 }, { volume: 2 }])
      expect(() => harp.render(options, 8000)).toThrow("renderSynthInstrument");
    expect(() => harp.render({}, 4000)).toThrow("sampleRate");
  });

  it("converts a sustain loop to seconds and leaves unpitched sounds without a root note", () => {
    const sustained = reed.render({}, 8000);
    expect(sustained.loopStart).toBeCloseTo(0.6, 2);
    expect(sustained.loopEnd! * 8000).toBeLessThanOrEqual(
      sustained.samples.length,
    );
    expect(hat.render({}, 8000).rootNote).toBeUndefined();
    expect(hat.pitched).toBe(false);
  });

  it("reports the fixed root note of an unpitched instrument that sets one", () => {
    expect(tom.pitched).toBe(false);
    expect(tom.render({ frequency: 880 }, 8000).rootNote).toBe(43);
    expect(() =>
      defineInstrument("bad", () => new Float32Array(1), { rootNote: 60 }),
    ).toThrow("pitched: false");
    expect(() =>
      defineInstrument("bad", () => new Float32Array(1), {
        pitched: false,
        rootNote: 128,
      }),
    ).toThrow("0 to 127, got 128");
  });

  it("rejects a render that returns no samples or a loop outside them", () => {
    const empty = defineInstrument("empty", () => new Float32Array(0));
    expect(() => empty.render({}, 8000)).toThrow(
      'Instrument "empty": render returned no samples',
    );
    for (const [loopStart, loopEnd] of [
      [4, 11],
      [6, 6],
      [-1, 5],
      [0.5, 5],
    ] as const) {
      const looped = defineInstrument("looped", () => ({
        samples: new Float32Array(10),
        loopStart,
        loopEnd,
      }));
      expect(() => looped.render({}, 8000)).toThrow(
        `Instrument "looped": render returned loop ${loopStart}..${loopEnd}`,
      );
    }
  });

  it("resolves by name from any bank and rejects two definitions with one name", () => {
    const parsed = parseSynthSound({ instrument: "harp", seed: 4 }, { harp });
    expect(renderSynthSample(parsed, 8000, { harp })).toEqual(
      harp.render({ seed: 4 }, 8000),
    );
    expect(
      renderSynthSample(harp.sound(), 8000, { lead: harp }).sampleRate,
    ).toBe(8000);
    const impostor = { ...flute, name: "harp" as const };
    expect(() =>
      renderSynthSample(harp.sound(), 8000, { harp, impostor }),
    ).toThrow('two definitions named "harp"');
    // @ts-expect-error flute is not in a literal bank of harp alone
    expect(() => renderSynthSample(flute.sound(), 8000, { harp })).toThrow(
      '"flute" is not registered',
    );
  });

  it("rejects a non-positive number at a building block's entry", () => {
    expect(() =>
      renderString(
        {
          frequency: 0,
          duration: 1,
          t60: 1,
          brightness: 0.5,
          pickPosition: 0.3,
          seed: 1,
        },
        8000,
      ),
    ).toThrow(
      "renderString: frequency must be a positive finite number, got 0",
    );
    expect(() =>
      renderModal(
        {
          frequency: 440,
          duration: 1,
          partials: [],
          attack: 0.001,
          strike: 0,
          strikeFrequency: 1000,
          seed: 1,
        },
        Infinity,
      ),
    ).toThrow("renderModal: sampleRate");
    expect(() =>
      renderMetal({ duration: 0.1, t60: -1, frequencyScale: 1, seed: 1 }, 8000),
    ).toThrow("renderMetal: t60");
    expect(() =>
      renderNoise({ color: "pink", duration: Number.NaN, seed: 1 }, 8000),
    ).toThrow("renderNoise: duration");
    expect(() =>
      renderMetal(
        { duration: 0.1, t60: 0.05, frequencyScale: 1, seed: 1, attack: -1 },
        8000,
      ),
    ).toThrow("renderMetal: attack must be a finite number of zero or more");
  });

  it("rejects a non-finite number before changing any sample", () => {
    const string = {
      frequency: 220,
      duration: 0.1,
      t60: 1,
      brightness: 0.5,
      pickPosition: 0.3,
      seed: 1,
    };
    const modal = {
      frequency: 440,
      duration: 0.1,
      partials: [{ ratio: 1, amp: 1, t60: 0.5 }],
      attack: 0.001,
      strike: 0,
      strikeFrequency: 1000,
      seed: 1,
    };
    const metal = { duration: 0.1, t60: 0.05, frequencyScale: 1, seed: 1 };
    const cases: Array<[() => unknown, string]> = [
      [() => normalize(new Float32Array([1]), NaN), "normalize: target"],
      [() => limit(new Float32Array([1]), NaN), "limit: ceiling"],
      [() => saturate(new Float32Array([1]), NaN), "saturate: drive"],
      [() => fadeIn(new Float32Array([1]), NaN), "fadeIn: n"],
      [() => fadeOut(new Float32Array([1]), NaN), "fadeOut: n"],
      [() => dcBlock(new Float32Array([1]), NaN), "dcBlock: sampleRate"],
      [
        () => prepareTonalLoop(new Float32Array(64), 8000, 8, 32, NaN, 4),
        "prepareTonalLoop: freq",
      ],
      [
        () => biquad(new Float32Array([1]), "lowpass", NaN, 0.7, 8000),
        "biquad: freq",
      ],
      [
        () => biquad(new Float32Array([1]), "peaking", 500, 1, 8000, NaN),
        "biquad: gainDb",
      ],
      [() => svf(new Float32Array([1]), "low", 500, NaN, 8000), "svf: q"],
      [
        () => svf(new Float32Array([1]), "low", () => NaN, 1, 8000),
        "svf: freq(0) must return a finite number",
      ],
      [() => seededRandom(NaN), "seededRandom: seed"],
      [
        () => renderString({ ...string, brightness: NaN }, 8000),
        "renderString: brightness",
      ],
      [
        () =>
          renderString(
            { ...string, vibrato: { hz: 5, cents: NaN, delay: 0 } },
            8000,
          ),
        "renderString: vibrato.cents",
      ],
      [
        () =>
          renderModal(
            { ...modal, partials: [{ ratio: 1, amp: NaN, t60: 0.5 }] },
            8000,
          ),
        "renderModal: partials[0].amp",
      ],
      [
        () => renderModal({ ...modal, strike: NaN }, 8000),
        "renderModal: strike",
      ],
      [() => renderMetal({ ...metal, noise: NaN }, 8000), "renderMetal: noise"],
      [
        () => renderNoise({ color: "white", duration: 0.1, seed: NaN }, 8000),
        "seededRandom: seed",
      ],
      [
        () =>
          renderAdditive(
            { frequency: 220, seed: 1, harmonics: [1, NaN], breath: false },
            8000,
          ),
        "renderAdditive: harmonics[1]",
      ],
    ];
    for (const [call, message] of cases) expect(call).toThrow(message);
    const samples = new Float32Array([0.5]);
    expect(() => normalize(samples, Infinity)).toThrow();
    expect(samples[0]).toBe(0.5);
  });

  it("renders a zero attack as an immediate start", () => {
    const hit = renderMetal(
      { duration: 0.1, t60: 0.05, frequencyScale: 1, seed: 1, attack: 0 },
      8000,
    );
    expect(hit.every(Number.isFinite)).toBe(true);
    const strike = renderModal(
      {
        frequency: 440,
        duration: 0.1,
        partials: [{ ratio: 1, amp: 1, t60: 0.1 }],
        attack: 0,
        strike: 0,
        strikeFrequency: 1000,
        seed: 1,
      },
      8000,
    );
    expect(strike.every(Number.isFinite)).toBe(true);
  });
});
