import { beforeEach, it, expect } from "vitest";
import { AudioManager } from "./AudioManager.js";
import { registerSound, clearRegisteredSounds } from "./assets.js";
import { FakeAudioContext, fakeBuffer } from "./test-helpers.js";
let context: FakeAudioContext;
let audio: AudioManager;
beforeEach(() => {
  clearRegisteredSounds();
  context = new FakeAudioContext();
  audio = new AudioManager(context.asContext());
  registerSound("tone", fakeBuffer(10));
});
it("replaces fades at the interpolated audio-time value", () => {
  const h = audio.play("tone");
  h.fadeTo(0, { duration: 2 });
  context.currentTime = 1;
  expect(h.volume).toBeCloseTo(0.5);
  h.fadeTo(1, { duration: 1 });
  context.currentTime = 1.5;
  expect(h.volume).toBeCloseTo(0.75);
});
it("integrates rate automation when pausing and preserves remaining start/stop time", () => {
  const h = audio.play("tone", { at: 1, stopAt: 5 });
  h.setSpeed(3, { at: 1, duration: 2 });
  context.currentTime = 2;
  h.paused = true;
  context.currentTime = 4;
  h.paused = false;
  expect(context.sources[1]!.offset).toBeCloseTo(1.5);
  expect(context.sources[1]!.stopTime).toBe(7);
  expect(h.speed).toBeCloseTo(2);
});
it("pauses a future voice without consuming its lead-in", () => {
  const h = audio.play("tone", { at: 3 });
  context.currentTime = 1;
  h.paused = true;
  context.currentTime = 5;
  h.paused = false;
  expect(context.sources[1]!.startTime).toBe(7);
  expect(context.sources[1]!.offset).toBe(0);
});
it("wraps source offsets inside registered sustain regions on resume", () => {
  registerSound("loop", fakeBuffer(3), { loopStart: 1, loopEnd: 2 });
  const h = audio.play("loop", { loop: true });
  context.currentTime = 2.5;
  h.paused = true;
  context.currentTime = 4;
  h.paused = false;
  expect(context.sources[1]!.offset).toBeCloseTo(1.5);
  expect(context.sources[1]!.loopStart).toBe(1);
});
it("freezes gain automation during a voice pause", () => {
  const h = audio.play("tone");
  h.fadeTo(0, { duration: 2 });
  context.currentTime = 1;
  h.paused = true;
  context.currentTime = 9;
  expect(h.volume).toBeCloseTo(0.5);
  h.paused = false;
  context.currentTime = 9.5;
  expect(h.volume).toBeCloseTo(0.25);
});
it("rejects invalid automation before replacing an existing fade", () => {
  const h = audio.play("tone");
  h.fadeTo(0, { duration: 2 });
  expect(() => h.setVolume(NaN)).toThrow();
  expect(() => h.setSpeed(-1)).toThrow();
  expect(() => h.setSpeed(Number.MAX_VALUE)).toThrow("Web Audio precision");
  expect(() => h.setSpeed(Number.MIN_VALUE)).toThrow("Web Audio precision");
  expect(h.speed).toBe(1);
  expect(() => h.setPan(Infinity)).toThrow();
  expect(() => h.setVolume(0, { duration: 1, curve: "exponential" })).toThrow();
  context.currentTime = 1;
  expect(h.volume).toBeCloseTo(0.5);
});
it("uses absolute context times for controls written during pause", () => {
  const h = audio.play("tone", { loop: true });
  context.currentTime = 1;
  h.paused = true;
  context.currentTime = 9;
  h.setSpeed(2, { at: 9, duration: 1 });
  h.setPan(1, { at: 9, duration: 1 });
  h.release(9, 1);
  h.paused = false;
  expect(context.sources.at(-1)!.stopTime).toBe(10);
  context.currentTime = 9.5;
  expect(h.volume).toBeCloseTo(0.5);
  expect(h.speed).toBeCloseTo(1.5);
  expect(h.pan).toBeCloseTo(0.5);
});
it("preserves source position while discarding old rate automation", () => {
  const h = audio.play("tone", { loop: true });
  for (let i = 1; i <= 10000; i++) {
    context.currentTime = i / 10000;
    h.setSpeed(1 + i / 10000);
    h.setVolume(0.5);
  }
  h.paused = true;
  context.currentTime = 2;
  h.paused = false;
  expect(context.sources.at(-1)!.offset).toBeCloseTo(1.49995, 5);
});
