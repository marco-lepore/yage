import { beforeEach, it, expect } from "vitest";
import {
  registerSound,
  registerLoadedSound,
  unregisterSound,
  unloadSound,
  getSound,
  clearRegisteredSounds,
  sound,
} from "./assets.js";
import { fakeBuffer } from "./test-helpers.js";
beforeEach(clearRegisteredSounds);
it("registers before a plugin exists and permits explicit runtime replacement", () => {
  const a = fakeBuffer();
  const b = fakeBuffer(1);
  registerSound("a", a);
  expect(getSound(sound("a").path)).toBe(a);
  registerSound("a", b);
  expect(getSound("a")).toBe(b);
  unregisterSound("a");
  expect(getSound("a")).toBeUndefined();
});
it("keeps loaded and runtime ownership disjoint", () => {
  const a = fakeBuffer();
  registerLoadedSound("file", a);
  expect(() => registerSound("file", fakeBuffer())).toThrow("loaded");
  unregisterSound("file");
  expect(getSound("file")).toBe(a);
  unloadSound("file");
  registerSound("file", a);
  expect(() => registerLoadedSound("file", fakeBuffer())).toThrow("registered");
  unloadSound("file");
  expect(getSound("file")).toBe(a);
});
it("shares a loaded file between engines until each releases it", () => {
  const first = fakeBuffer();
  expect(registerLoadedSound("file", first, { rootNote: 60 })).toBe(first);
  expect(registerLoadedSound("file", fakeBuffer(), { rootNote: 60 })).toBe(
    first,
  );
  expect(() =>
    registerLoadedSound("file", fakeBuffer(), { rootNote: 62 }),
  ).toThrow('Audio asset "file": another engine loaded this file');
  unloadSound("file");
  expect(getSound("file")).toBe(first);
  unloadSound("file");
  expect(getSound("file")).toBeUndefined();
});
it("rejects corrupt samples and invalid sustain regions", () => {
  const b = fakeBuffer();
  b.getChannelData(0)[5] = NaN;
  expect(() => registerSound("bad", b)).toThrow("sample 5");
  expect(() =>
    registerSound("loop", fakeBuffer(), { loopStart: 1, loopEnd: 3 }),
  ).toThrow("sustain");
});
