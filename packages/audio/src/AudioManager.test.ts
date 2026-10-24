import { beforeEach, describe, it, expect, vi } from "vitest";
import { ErrorBoundary, Logger, createRandomService } from "@yagejs/core";
import { AudioManager } from "./AudioManager.js";
import { registerSound, clearRegisteredSounds, sound } from "./assets.js";
import { FakeAudioContext, fakeBuffer } from "./test-helpers.js";
let context: FakeAudioContext;
let audio: AudioManager;
beforeEach(() => {
  clearRegisteredSounds();
  context = new FakeAudioContext();
  audio = new AudioManager(context.asContext());
  registerSound("tone", fakeBuffer());
});
describe("scheduled playback and mixer ownership", () => {
  it("books precise source times, offsets and stops", () => {
    const h = audio.play(sound("tone"), {
      at: 1.125,
      offset: 0.4,
      stopAt: 1.8,
      pan: -0.5,
      speed: 2,
    });
    expect(context.sources[0]).toMatchObject({
      startTime: 1.125,
      offset: 0.4,
      stopTime: 1.8,
    });
    expect(h.scheduled).toBe(true);
    expect(audio.getDiagnostics().scheduledVoices).toBe(1);
  });
  it("cancels a future voice immediately and releases ownership", () => {
    const end = vi.fn();
    const h = audio.play("tone", { at: 10, onEnd: end });
    h.stop();
    expect(h.playing).toBe(false);
    expect(context.sources[0]!.disconnected).toBe(true);
    expect(audio.getDiagnostics().activeVoices).toBe(0);
    expect(end).not.toHaveBeenCalled();
  });
  it("routes booked voices through shared channel gain and independent voice mute", () => {
    const h = audio.play("tone", { at: 1, volume: 0.5, channel: "music" });
    audio.setChannelVolume("music", 0.4);
    audio.masterVolume = 0.6;
    h.muted = true;
    audio.muteChannel("music");
    audio.unmuteChannel("music");
    expect(h.muted).toBe(true);
    expect(h.volume).toBe(0.5);
    expect(audio.getChannelVolume("music")).toBe(0.4);
    expect(context.gains[0]!.gain.value).toBe(0.6);
  });
  it("owns child channels recursively without affecting other managers", () => {
    audio.createChannel("layer", { parent: "music" });
    const h = audio.play("tone", { channel: "layer" });
    const other = new AudioManager(context.asContext());
    const separate = other.play("tone");
    audio.removeChannel("music");
    expect(h.playing).toBe(false);
    expect(audio.getChannelNames()).not.toContain("layer");
    expect(separate.playing).toBe(true);
  });
  it("preserves explicit voice pause across channel pause and resume", () => {
    const h = audio.play("tone");
    h.paused = true;
    audio.pauseChannel("sfx");
    audio.resumeChannel("sfx");
    expect(h.paused).toBe(true);
    h.paused = false;
    expect(h.paused).toBe(false);
  });
  it("applies an inherited channel pause to new voices", () => {
    audio.createChannel("layer", { parent: "music" });
    audio.pauseChannel("music");
    expect(audio.play("tone", { channel: "layer" }).paused).toBe(true);
  });
  it("keeps independent request owners and a playOnce owner", () => {
    const a = audio.requestOnce("tone");
    const b = audio.requestOnce("tone");
    expect(context.sources).toHaveLength(1);
    a.release();
    expect(b.active).toBe(true);
    const h = audio.playOnce("tone");
    b.release();
    expect(h.playing).toBe(true);
    audio.stopAll();
    expect(h.playing).toBe(false);
  });
  it("keeps the final fading request active and starts a fresh shared recording", () => {
    const a = audio.requestOnce("tone");
    a.release({ fadeOut: 0.5 });
    const b = audio.requestOnce("tone");
    expect(context.sources).toHaveLength(2);
    expect(a.active).toBe(true);
    context.currentTime = 0.5;
    context.sources[0]!.end();
    expect(a.active).toBe(false);
    expect(b.active).toBe(true);
  });
  it("calls only active owners on natural completion, never explicit stop", () => {
    const a = vi.fn();
    const b = vi.fn();
    audio.requestOnce("tone", { onEnd: a }).release();
    audio.requestOnce("tone", { onEnd: b });
    context.sources.at(-1)!.end();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });
  it("holds locked voices on the context clock and dispatches unlock once", () => {
    context.state = "suspended";
    audio.play("tone", { at: 0.2 });
    const cb = vi.fn();
    audio.onUnlock(cb);
    audio._handleGesture();
    expect(cb).not.toHaveBeenCalled();
    context.state = "running";
    audio._handleGesture();
    audio._handleGesture();
    expect(cb).toHaveBeenCalledOnce();
    expect(context.sources[0]!.startTime).toBe(0.2);
  });
  it("reports and rethrows callback errors, ending fan-out", () => {
    const boundary = new ErrorBoundary(new Logger({ output: () => {} }));
    audio._setErrorBoundary(boundary);
    context.state = "suspended";
    const after = vi.fn();
    audio.onUnlock(() => {
      throw new Error("unlock failed");
    });
    audio.onUnlock(after);
    context.state = "running";
    expect(() => audio._handleGesture()).toThrow("unlock failed");
    expect(after).not.toHaveBeenCalled();
    expect(boundary.getCallbackErrors()[0]?.kind).toBe("Audio unlock callback");
    expect(audio.getDiagnostics().failures[0]?.message).toBe("unlock failed");
  });
  it("attributes scheduler and completion failures without swallowing", () => {
    const boundary = new ErrorBoundary(new Logger({ output: () => {} }));
    audio._setErrorBoundary(boundary);
    audio.addScheduler(() => {
      throw new Error("arrangement");
    });
    expect(() => audio.updateSchedule()).toThrow("arrangement");
    audio.play("tone", {
      onEnd: () => {
        throw new Error("end");
      },
    });
    expect(() => context.sources[0]!.end()).toThrow("end");
    expect(boundary.getCallbackErrors().map((e) => e.kind)).toEqual([
      "Audio scheduler callback",
      "Audio onEnd callback",
    ]);
  });
  it("disposes voices, pending unlock and scheduler subscriptions", () => {
    const cb = vi.fn();
    audio.addScheduler(cb);
    audio.play("tone");
    audio.dispose();
    expect(audio.getDiagnostics().activeVoices).toBe(0);
    expect(audio.getDiagnostics().schedulerCount).toBe(0);
    expect(() => audio.play("tone")).toThrow("disposed");
  });
  it("rejects invalid inputs before creating voices or channels", () => {
    for (const options of [
      { volume: NaN },
      { speed: 0 },
      { speed: Infinity },
      { speed: Number.MAX_VALUE },
      { speed: Number.MIN_VALUE },
      { pan: 2 },
      { at: -1 },
      { offset: 2 },
      { loop: true, loopStart: 1, loopEnd: 0.5 },
      { stopAt: 1, at: 2 },
    ])
      expect(() =>
        audio.play("tone", { ...options, channel: "invalid" }),
      ).toThrow();
    expect(context.sources).toHaveLength(0);
    expect(audio.getChannelNames()).not.toContain("invalid");
    expect(() => audio.play("missing")).toThrow('"missing"');
  });
  it("validates a crossfade before changing outgoing playback", () => {
    const h = audio.play("tone");
    expect(() => audio.crossfade(h, "missing", { duration: 1 })).toThrow(
      "missing",
    );
    expect(h.volume).toBe(1);
  });
});
it("rejects a past crossfade time without starting another source", () => {
  const outgoing = audio.play("tone", { loop: true });
  context.currentTime = 2;
  expect(() =>
    audio.crossfade(outgoing, "tone", { at: 1, duration: 1 }),
  ).toThrow();
  expect(context.sources).toHaveLength(1);
  expect(outgoing.volume).toBe(1);
});
it("reports natural completion even when the ended event arrives after a later booked stop", () => {
  const end = vi.fn();
  audio.play("tone", { speed: 2, stopAt: 2, onEnd: end });
  context.currentTime = 3;
  context.sources[0]!.end();
  expect(end).toHaveBeenCalledOnce();
});
it("does not report natural completion for a stop before the buffer ends", () => {
  const end = vi.fn();
  audio.play("tone", { speed: 0.5, stopAt: 2, onEnd: end });
  context.currentTime = 5;
  context.sources[0]!.end();
  expect(end).not.toHaveBeenCalled();
});
it("holds channel gain automation at the paused audio position", () => {
  audio.setChannelVolume("music", 0, { duration: 2 });
  context.currentTime = 1;
  audio.pauseChannel("music");
  context.currentTime = 9;
  expect(audio.getChannelVolume("music")).toBeCloseTo(0.35);
  audio.setChannelVolume("music", 1, { at: 9, duration: 1 });
  audio.resumeChannel("music");
  context.currentTime = 9.5;
  expect(audio.getChannelVolume("music")).toBeCloseTo(0.675);
});
it("does not count playback after a scheduled stop when its event is delayed", () => {
  const end = vi.fn();
  const voice = audio.play("tone", { stopAt: 1, onEnd: end });
  context.currentTime = 3;
  voice.setSpeed(2);
  context.sources[0]!.end();
  expect(end).not.toHaveBeenCalled();
});
it("accepts immediate crossfades when audio time advances during node creation", () => {
  const outgoing = audio.play("tone", { loop: true });
  const create = context.createGain.bind(context);
  vi.spyOn(context, "createGain").mockImplementation(() => {
    context.currentTime += 0.005;
    return create();
  });
  expect(() =>
    audio.crossfade(outgoing, "tone", { duration: 0.1 }),
  ).not.toThrow();
});
describe("lookup, random choice and global mute", () => {
  it("reports registration for aliases and handles alike", () => {
    expect(audio.hasSound("tone")).toBe(true);
    expect(audio.hasSound(sound("tone"))).toBe(true);
    expect(audio.hasSound("missing")).toBe(false);
    registerSound("pitched", fakeBuffer(), { rootNote: 57 });
    expect(audio.getSoundMetadata("pitched")).toEqual({ rootNote: 57 });
    expect(audio.getSoundMetadata("missing")).toBeUndefined();
  });
  it("picks a random alias with the injected generator and rejects an empty list", () => {
    registerSound("other", fakeBuffer());
    const picks = (seed: number): string[] => {
      const manager = new AudioManager(
        new FakeAudioContext().asContext(),
        {},
        createRandomService(seed),
      );
      return Array.from(
        { length: 8 },
        () => manager.playRandom(["tone", "other"]).alias,
      );
    };
    expect(picks(7)).toEqual(picks(7));
    expect(new Set(picks(7))).toEqual(new Set(["tone", "other"]));
    expect(() => audio.playRandom([])).toThrow("must not be empty");
  });
  it("mutes and unmutes every channel without touching its volume", () => {
    audio.setChannelVolume("music", 0.4);
    audio.muteAll();
    expect(audio.getDiagnostics().channels.every((c) => c.muted)).toBe(true);
    audio.unmuteAll();
    const channels = audio.getDiagnostics().channels;
    expect(channels.some((c) => c.muted)).toBe(false);
    expect(channels.find((c) => c.name === "music")?.volume).toBe(0.4);
  });
});
