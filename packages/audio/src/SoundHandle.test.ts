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

  it("volume setter delegates to instance", () => {
    handle.volume = 0.5;
    expect(instance.volume).toBe(0.5);
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
