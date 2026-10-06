import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IMediaInstance } from "@pixi/sound";

import { SoundHandle } from "./SoundHandle.js";

type MockMediaInstance = IMediaInstance & { _emit(event: string): void };

function createMockInstance(id = 1): MockMediaInstance {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    id,
    progress: 0,
    paused: false,
    volume: 1,
    speed: 1,
    loop: false,
    muted: false,
    stop: vi.fn(() => {
      const fns = listeners.get("stop") ?? [];
      for (const fn of fns) fn();
    }),
    refresh: vi.fn(),
    refreshPaused: vi.fn(),
    init: vi.fn(),
    play: vi.fn(),
    destroy: vi.fn(),
    toString: vi.fn(() => ""),
    set: vi.fn(),
    once: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      const list = listeners.get(event) ?? [];
      list.push(fn);
      listeners.set(event, list);
    }),
    on: vi.fn(),
    off: vi.fn(),
    _emit(event: string) {
      const fns = listeners.get(event) ?? [];
      for (const fn of fns) fn();
    },
  } as unknown as MockMediaInstance;
}

describe("SoundHandle", () => {
  let instance: MockMediaInstance;
  let handle: SoundHandle;

  beforeEach(() => {
    instance = createMockInstance(42);
    handle = new SoundHandle(instance);
  });

  it("exposes the instance id", () => {
    expect(handle.id).toBe(42);
  });

  it("starts as playing", () => {
    expect(handle.playing).toBe(true);
  });

  it("defaults standalone handles to the sfx channel", () => {
    expect(handle.channel).toBe("sfx");
  });

  it("becomes not playing on end event", () => {
    instance._emit("end");
    expect(handle.playing).toBe(false);
  });

  it("becomes not playing on stop event", () => {
    instance._emit("stop");
    expect(handle.playing).toBe(false);
  });

  it("stop() delegates to instance.stop()", () => {
    handle.stop();
    expect(instance.stop).toHaveBeenCalled();
  });

  it("stops a paused real WebAudio instance and emits completion once", async () => {
    // Import the backend without initializing the browser-only sound singleton.
    const entry = createRequire(import.meta.url).resolve("@pixi/sound");
    const backendUrl = new URL(
      "./webaudio/WebAudioInstance.mjs",
      pathToFileURL(entry),
    );
    const { WebAudioInstance } = (await import(backendUrl.href)) as {
      WebAudioInstance: new (media: unknown) => IMediaInstance;
    };
    const events = new EventEmitter();
    const backend = new WebAudioInstance({
      context: { events, paused: false },
      parent: { paused: false },
    });
    backend.volume = 1;
    backend.paused = true;
    // Pixi Sound registers this cleanup before the handle's listeners.
    backend.once("stop", () => backend.destroy());
    const stopped = vi.fn();
    backend.once("stop", stopped);
    const paused = new SoundHandle(backend);
    paused.stop();
    paused.stop();
    expect(paused.playing).toBe(false);
    expect(stopped).toHaveBeenCalledOnce();
    expect(events.listenerCount("refreshPaused")).toBe(0);
    expect(events.listenerCount("refresh")).toBe(0);
    expect(() => events.emit("refreshPaused")).not.toThrow();
  });

  it("volume setter delegates to instance", () => {
    handle.volume = 0.5;
    expect(instance.volume).toBe(0.5);
  });

  it("rejects a non-finite or out-of-range volume", () => {
    expect(() => (handle.volume = Number.NaN)).toThrow(
      "SoundHandle.volume: volume must be a finite number from 0 to 1, got NaN.",
    );
    expect(() => (handle.volume = -0.1)).toThrow(
      "SoundHandle.volume: volume must be a finite number from 0 to 1, got -0.1.",
    );
  });

  it("rejects fadeTo when the handle has no manager fade queue", () => {
    expect(() => handle.fadeTo(0, { duration: 1 })).toThrow(
      "SoundHandle.fadeTo: this handle was not created by an installed AudioManager.",
    );
  });

  it("speed setter delegates to instance", () => {
    handle.speed = 2;
    expect(instance.speed).toBe(2);
  });

  it("muted setter delegates to instance", () => {
    handle.muted = true;
    expect(instance.muted).toBe(true);
  });
});
