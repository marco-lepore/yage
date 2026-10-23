import { beforeEach, it, expect, vi, afterEach } from "vitest";
import { AssetManager, AssetManagerKey, EngineContext } from "@yagejs/core";
import { soundBank, parseSoundBankManifest } from "./bank.js";
import { AudioPlugin } from "./AudioPlugin.js";
import { getSound, getSoundMetadata, clearRegisteredSounds } from "./assets.js";
import { fakeBuffer, FakeAudioContext } from "./test-helpers.js";

const manifest = {
  version: 1,
  sampleRate: 44100,
  sounds: {
    flute: {
      file: "flute.wav",
      frames: 88200,
      bytes: 176444,
      samplePeak: 0.3,
      rms: 0.1,
      clippedSamples: 0,
      rootNote: 60,
      loopStart: 0.6,
      loopEnd: 1.8,
    },
  },
};
beforeEach(clearRegisteredSounds);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("loads loop metadata through the shared asset loader and retains it until the last owner unloads", async () => {
  vi.useFakeTimers();
  const decode = vi.fn().mockResolvedValue(fakeBuffer(2));
  class Context extends FakeAudioContext {
    decodeAudioData = decode;
  }
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(44)),
    }),
  );
  const assets = new AssetManager();
  const context = new EngineContext();
  context.register(AssetManagerKey, assets);
  const plugin = new AudioPlugin();
  plugin.install(context);
  const bank = soundBank(manifest, "/music/");
  const handles = Object.values(bank.sounds);
  await assets.loadAll(handles);
  await assets.loadAll(handles);
  expect(decode).toHaveBeenCalledOnce();
  expect(getSoundMetadata("/music/flute.wav")).toEqual({
    loopStart: 0.6,
    loopEnd: 1.8,
    rootNote: 60,
  });
  await assets.unload(handles[0]!);
  expect(getSound("/music/flute.wav")).toBeDefined();
  await assets.unload(handles[0]!);
  expect(getSound("/music/flute.wav")).toBeUndefined();
  plugin.onDestroy();
});
it("copies metadata and rejects invalid loops or paths before loading", () => {
  const bank = soundBank(manifest, "/music/");
  bank.manifest.sounds.flute!.loopStart = 1;
  expect(manifest.sounds.flute.loopStart).toBe(0.6);
  for (const override of [
    { file: "../escape.wav" },
    { loopEnd: 3 },
    { rootNote: NaN },
    { frames: Infinity },
  ])
    expect(() =>
      parseSoundBankManifest({
        ...manifest,
        sounds: {
          flute: { ...manifest.sounds.flute, ...override },
        },
      }),
    ).toThrow();
});
it("accepts a hand-written manifest that lists only files, loops and root notes", () => {
  const bank = soundBank(
    {
      version: 1,
      sampleRate: 44100,
      sounds: {
        hit: { file: "hit.wav" },
        pad: { file: "pad.wav", rootNote: 57, loopStart: 0.5, loopEnd: 1.5 },
      },
    },
    "/sfx/",
  );
  expect(bank.sounds.hit!.path).toBe("/sfx/hit.wav");
  expect(bank.sounds.pad!.data).toEqual({
    loopStart: 0.5,
    loopEnd: 1.5,
    rootNote: 57,
  });
  expect(() =>
    parseSoundBankManifest({
      version: 1,
      sampleRate: 44100,
      sounds: { pad: { file: "pad.wav", loopStart: 1 } },
    }),
  ).toThrow("loopEnd");
  // One file loads once, so two entries cannot give it two root notes.
  expect(() =>
    parseSoundBankManifest({
      version: 1,
      sampleRate: 44100,
      sounds: {
        low: { file: "pad.wav", rootNote: 57 },
        high: { file: "pad.wav", rootNote: 69 },
      },
    }),
  ).toThrow("conflicting metadata");
});
