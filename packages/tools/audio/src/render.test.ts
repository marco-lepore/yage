import { synthInstruments } from "@yagejs-addons/synth/instruments";
import { it, expect } from "vitest";
import { renderAudioBank, listAudioInstruments } from "./render.js";
import { parseAudioBankConfig } from "./config.js";
import { renderSynthSample } from "@yagejs-addons/synth/render";

const sound = { instrument: "flute" as const, seed: 17 };
const config = {
  version: 1,
  sampleRate: 8000,
  sounds: {
    lead: { sound, rootNote: 60 },
    same: { sound, rootNote: 72 },
    unused: { sound: { instrument: "organ" } },
  },
  include: ["lead", "same"],
};
it("exports only selected sounds, deduplicates audio and preserves tuning and sustain", async () => {
  const bank = await renderAudioBank(config);
  expect(Object.keys(bank.manifest.sounds)).toEqual(["lead", "same"]);
  expect(bank.files).toHaveLength(1);
  expect(bank.manifest.sounds.lead?.file).toBe(bank.manifest.sounds.same?.file);
  expect(bank.manifest.sounds.same?.rootNote).toBe(72);
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
      same: { sound: { seed: 17, instrument: "flute" }, rootNote: 72 },
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
