import { synthInstruments } from "@yagejs-addons/synth/instruments";
import { it, expect } from "vitest";
import { renderAudioBank, listAudioInstruments } from "./render.js";
import { parseAudioBankConfig } from "./config.js";
import {
  defineInstrument,
  limit,
  normalize,
  renderMetal,
  renderSynthSample,
  renderString,
} from "@yagejs-addons/synth/render";

const sound = { instrument: "flute" as const, seed: 17 };
const config = {
  version: 1,
  sampleRate: 8000,
  sounds: {
    lead: { sound },
    same: { sound },
    unused: { sound: { instrument: "organ" } },
  },
  include: ["lead", "same"],
};
it("exports only selected sounds, deduplicates audio and preserves tuning and sustain", async () => {
  const bank = await renderAudioBank(config);
  expect(Object.keys(bank.manifest.sounds)).toEqual(["lead", "same"]);
  expect(bank.files).toHaveLength(1);
  expect(bank.manifest.sounds.lead?.file).toBe(bank.manifest.sounds.same?.file);
  // The flute renders at middle C.
  expect(bank.manifest.sounds.lead?.rootNote).toBe(60);
  expect(bank.manifest.sounds.same?.rootNote).toBe(60);
  const original = renderSynthSample(sound, 8000, synthInstruments);
  expect(bank.manifest.sounds.lead?.loopStart).toBe(original.loopStart);
  expect(bank.manifest.sounds.lead?.loopEnd).toBe(original.loopEnd);
  const bytes = bank.files[0]!.data;
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(24, true)).toBe(8000);
  expect(view.getUint32(40, true)).toBe(original.samples.length * 2);
  // Decode the exported PCM independently and bound the quantization error.
  for (let i = 0; i < original.samples.length; i++) {
    const sample = view.getInt16(44 + i * 2, true);
    const decoded = sample / (sample < 0 ? 32768 : 32767);
    expect(Math.abs(decoded - original.samples[i]!)).toBeLessThan(1 / 32767);
  }
});
it("produces identical files across builds and config key order", async () => {
  const a = await renderAudioBank(config);
  const b = await renderAudioBank({
    ...config,
    include: ["same", "lead"],
    sounds: {
      ...config.sounds,
      same: { sound: { seed: 17, instrument: "flute" } },
    },
  });
  expect(a).toEqual(b);
});
it("shares the new instruments with the runtime catalogue", () => {
  expect(listAudioInstruments()).toEqual(
    expect.arrayContaining(["flute", "clarinet", "organ"]),
  );
});
it.each([
  { ...config, include: ["missing"] },
  { ...config, include: ["lead", "lead"] },
  { ...config, sampleRate: NaN },
  { ...config, version: 2 },
  {
    ...config,
    sounds: { a: { sound: { instrument: "flute", frequncy: 440 } } },
  },
  { ...config, sounds: { a: { sound: { wave: "unknown" } } } },
  { ...config, sounds: { a: { sound: { duration: Infinity } } } },
])("rejects malformed config before rendering", (input) => {
  expect(() => parseAudioBankConfig(input)).toThrow();
});
it("rejects clipping instead of silently changing the authored gain", async () => {
  await expect(
    renderAudioBank({
      version: 1,
      sampleRate: 8000,
      sounds: {
        loud: {
          sound: [
            { wave: "square", volume: 1 },
            { wave: "square", volume: 1 },
          ],
        },
      },
    }),
  ).rejects.toThrow("clipped");
});
it("derives root notes from instrument frequencies and leaves drums unpitched", async () => {
  const bank = await renderAudioBank({
    version: 1,
    sampleRate: 8000,
    sounds: {
      bass: { sound: { instrument: "bass", frequency: 130.812783 } },
      kick: { sound: { instrument: "kick" } },
    },
  });
  expect(bank.manifest.sounds.bass?.rootNote).toBe(48);
  expect(bank.manifest.sounds.kick?.rootNote).toBeUndefined();
});
it("lets a config rootNote override the derived pitch but not split one file", async () => {
  const bank = await renderAudioBank({
    version: 1,
    sampleRate: 8000,
    sounds: { lead: { sound, rootNote: 72 } },
  });
  expect(bank.manifest.sounds.lead?.rootNote).toBe(72);
  await expect(
    renderAudioBank({
      version: 1,
      sampleRate: 8000,
      sounds: { lead: { sound }, same: { sound, rootNote: 72 } },
    }),
  ).rejects.toThrow('renders the same audio as "lead"');
});

const harp = defineInstrument("harp", (frequency, sampleRate, seed) =>
  limit(
    normalize(
      renderString(
        {
          frequency,
          duration: 0.4,
          t60: 0.3,
          brightness: 0.6,
          pickPosition: 0.3,
          seed,
        },
        sampleRate,
      ),
    ),
  ),
);
const hat = defineInstrument(
  "hat",
  (_frequency, sampleRate, seed) =>
    limit(
      normalize(
        renderMetal(
          { duration: 0.1, t60: 0.04, frequencyScale: 1.9, seed },
          sampleRate,
        ),
      ),
    ),
  { pitched: false },
);
it("exports custom instruments from a supplied bank", async () => {
  const instruments = { ...synthInstruments, harp, hat };
  const custom = {
    version: 1,
    sampleRate: 8000,
    sounds: {
      pluck: { sound: { instrument: "harp", frequency: 220 } },
      tick: { sound: { instrument: "hat" } },
      flute: { sound: { instrument: "flute" } },
    },
  };
  const bank = await renderAudioBank(custom, { instruments });
  expect(bank.manifest.sounds.pluck?.rootNote).toBe(57);
  expect(bank.manifest.sounds.tick?.rootNote).toBeUndefined();
  expect(bank.manifest.sounds.flute?.rootNote).toBe(60);
  expect(listAudioInstruments(instruments)).toEqual(
    expect.arrayContaining(["flute", "harp", "hat"]),
  );
  // Without the bank, the config names an unknown instrument.
  await expect(renderAudioBank(custom)).rejects.toThrow("pluck");
});
