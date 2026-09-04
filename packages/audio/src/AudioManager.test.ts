import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SoundLibrary, IMediaInstance } from "@pixi/sound";

// `sound()` lives beside `registerSound`, which imports `@pixi/sound`'s
// singleton — it constructs an `AudioContext` unavailable under Vitest. The
// manager under test is driven by its own fake library, so the singleton only
// has to exist.
vi.mock("@pixi/sound", () => ({ sound: {} }));

import { ErrorBoundary, Logger, LogLevel } from "@yagejs/core";
import { AudioManager } from "./AudioManager.js";
import { sound } from "./assets.js";

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

type MockSoundLibrary = SoundLibrary & {
  _instances: Map<string, MockMediaInstance>;
};

function setAudioContextState(
  s: SoundLibrary,
  state: "suspended" | "running",
): void {
  (
    s as unknown as { context: { audioContext: { state: string } } }
  ).context.audioContext.state = state;
}

function createMockSoundLibrary(options?: {
  state?: "suspended" | "running";
  muted?: boolean;
  autoPause?: boolean;
  paused?: boolean;
}): MockSoundLibrary {
  const instances = new Map<string, MockMediaInstance>();
  let nextId = 1;

  const context = {
    muted: options?.muted ?? false,
    autoPause: options?.autoPause ?? true,
    paused: options?.paused ?? false,
    audioContext: { state: options?.state ?? "running" },
  };

  return {
    _instances: instances,
    context,
    play: vi.fn((alias: string) => {
      const inst = createMockInstance(nextId++);
      instances.set(alias, inst);
      return inst;
    }),
    stop: vi.fn(),
    muteAll: vi.fn(),
    unmuteAll: vi.fn(),
    close: vi.fn(),
    exists: vi.fn(() => true),
  } as unknown as MockSoundLibrary;
}

describe("AudioManager", () => {
  let mockSound: MockSoundLibrary;
  let manager: AudioManager;

  beforeEach(() => {
    mockSound = createMockSoundLibrary();
    manager = new AudioManager(mockSound);
  });

  describe("channels", () => {
    it("creates default sfx and music channels", () => {
      expect(manager.getChannelVolume("sfx")).toBe(1);
      expect(manager.getChannelVolume("music")).toBe(0.7);
    });

    it("uses custom channel config", () => {
      const custom = new AudioManager(mockSound, {
        channels: { ui: { volume: 0.5 }, ambient: { volume: 0.3 } },
      });
      expect(custom.getChannelVolume("ui")).toBe(0.5);
      expect(custom.getChannelVolume("ambient")).toBe(0.3);
    });

    it("auto-creates channels on first use", () => {
      manager.play("test", { channel: "custom" });
      expect(manager.getChannelVolume("custom")).toBe(1);
    });
  });

  describe("play()", () => {
    it("calls sound.play() with alias and correct options", () => {
      manager.play("explosion", { volume: 0.8, loop: true, speed: 1.5 });
      expect(mockSound.play).toHaveBeenCalledWith("explosion", {
        volume: 0.8, // sfx channel volume (1) * instance volume (0.8)
        loop: true,
        speed: 1.5,
      });
    });

    it("applies channel volume x instance volume", () => {
      manager.setChannelVolume("sfx", 0.5);
      manager.play("test", { volume: 0.6 });
      expect(mockSound.play).toHaveBeenCalledWith("test", {
        volume: 0.3, // 0.5 * 0.6
        loop: false,
        speed: 1,
      });
    });

    it("defaults to sfx channel", () => {
      const handle = manager.play("test");
      expect(handle.playing).toBe(true);
    });

    it("returns a SoundHandle", () => {
      const handle = manager.play("test");
      expect(handle).toBeDefined();
      expect(handle.playing).toBe(true);
      expect(typeof handle.id).toBe("number");
    });

    it("throws if sound is not preloaded (Promise returned)", () => {
      (mockSound.play as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        Promise.resolve(createMockInstance()),
      );
      expect(() => manager.play("unloaded")).toThrow("not preloaded");
    });

    it("throws naming the alias when nothing is registered under it", () => {
      (mockSound.exists as ReturnType<typeof vi.fn>).mockReturnValue(false);
      expect(() => manager.play("sfx/coni.wav")).toThrow(
        'AudioManager.play: no sound registered as "sfx/coni.wav"',
      );
      expect(mockSound.play).not.toHaveBeenCalled();
    });

    it("accepts a sound() handle and plays the alias it registers", () => {
      manager.play(sound("assets/coin.wav"), { volume: 0.5 });
      expect(mockSound.play).toHaveBeenCalledWith("assets/coin.wav", {
        volume: 0.5,
        loop: false,
        speed: 1,
      });
    });
  });

  describe("playOnce()", () => {
    it("reuses the handle of a sound that is still playing", () => {
      const first = manager.playOnce("music", { channel: "music" });
      const second = manager.playOnce("music", { channel: "music" });
      expect(second).toBe(first);
      expect(mockSound.play).toHaveBeenCalledTimes(1);
    });

    it("matches a sound() handle against an alias already playing", () => {
      const first = manager.playOnce("assets/coin.wav");
      const second = manager.playOnce(sound("assets/coin.wav"));
      expect(second).toBe(first);
      expect(mockSound.play).toHaveBeenCalledTimes(1);
    });

    it("throws naming the alias when nothing is registered under it", () => {
      (mockSound.exists as ReturnType<typeof vi.fn>).mockReturnValue(false);
      expect(() => manager.playOnce("typo")).toThrow(
        'no sound registered as "typo"',
      );
    });

    it("keeps an outside playOnce owner when a request releases", () => {
      const outside = manager.playOnce("impact");
      const request = manager.requestOnce("impact");

      request.release();

      expect(request.active).toBe(false);
      expect(outside.playing).toBe(true);
      expect(mockSound.play).toHaveBeenCalledTimes(1);
    });

    it("adds one playOnce owner when requests started the shared playback", () => {
      const request = manager.requestOnce("impact");
      const outside = manager.playOnce("impact");
      const repeated = manager.playOnce("impact");

      request.release();

      expect(outside).toBe(repeated);
      expect(outside.playing).toBe(true);
      expect(mockSound.play).toHaveBeenCalledTimes(1);
    });
  });

  describe("requestOnce()", () => {
    it("throws naming the alias when nothing is registered under it", () => {
      (mockSound.exists as ReturnType<typeof vi.fn>).mockReturnValue(false);

      expect(() => manager.requestOnce("typo")).toThrow(
        'no sound registered as "typo"',
      );
      expect(mockSound.play).not.toHaveBeenCalled();
    });

    it("releases independent requests without stopping another owner", () => {
      const first = manager.requestOnce("impact");
      const second = manager.requestOnce("impact");
      const instance = mockSound._instances.get("impact")!;

      first.release();
      first.release();
      expect(first.active).toBe(false);
      expect(second.active).toBe(true);
      expect(instance.stop).not.toHaveBeenCalled();

      second.release();
      expect(second.active).toBe(false);
      expect(instance.stop).toHaveBeenCalledOnce();
    });

    it("calls every active request callback on natural completion", () => {
      const firstEnd = vi.fn();
      const secondEnd = vi.fn();
      const first = manager.requestOnce("impact", { onEnd: firstEnd });
      const second = manager.requestOnce("impact", { onEnd: secondEnd });

      mockSound._instances.get("impact")!._emit("end");

      expect(first.active).toBe(false);
      expect(second.active).toBe(false);
      expect(firstEnd).toHaveBeenCalledOnce();
      expect(secondEnd).toHaveBeenCalledOnce();
    });

    it("does not call a released request's callback", () => {
      const releasedEnd = vi.fn();
      const activeEnd = vi.fn();
      const released = manager.requestOnce("impact", {
        onEnd: releasedEnd,
      });
      manager.requestOnce("impact", { onEnd: activeEnd });

      released.release();
      mockSound._instances.get("impact")!._emit("end");

      expect(releasedEnd).not.toHaveBeenCalled();
      expect(activeEnd).toHaveBeenCalledOnce();
    });

    it("clears every request when a channel force-stops the sound", () => {
      const first = manager.requestOnce("impact");
      const second = manager.requestOnce("impact");

      manager.stopChannel("sfx");

      expect(first.active).toBe(false);
      expect(second.active).toBe(false);
      manager.requestOnce("impact");
      expect(mockSound.play).toHaveBeenCalledTimes(2);
    });
  });

  describe("playRandom()", () => {
    it("plays one of the provided aliases", () => {
      const aliases = ["a", "b", "c"];
      manager.playRandom(aliases);
      const calledAlias = (mockSound.play as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as string;
      expect(aliases).toContain(calledAlias);
    });

    it("accepts sound() handles", () => {
      manager.playRandom([sound("assets/step.wav")]);
      expect(mockSound.play).toHaveBeenCalledWith(
        "assets/step.wav",
        expect.anything(),
      );
    });

    it("throws on empty aliases array", () => {
      expect(() => manager.playRandom([])).toThrow("must not be empty");
    });

    it("throws naming the alias when nothing is registered under it", () => {
      (mockSound.exists as ReturnType<typeof vi.fn>).mockReturnValue(false);
      expect(() => manager.playRandom(["typo"])).toThrow(
        'no sound registered as "typo"',
      );
    });
  });

  describe("stop()", () => {
    it("stops a specific handle", () => {
      const handle = manager.play("test");
      manager.stop(handle);
      expect(handle.playing).toBe(false);
    });
  });

  describe("stopChannel()", () => {
    it("stops all handles in a channel", () => {
      const h1 = manager.play("a");
      const h2 = manager.play("b");
      manager.stopChannel("sfx");
      expect(h1.playing).toBe(false);
      expect(h2.playing).toBe(false);
    });

    it("does nothing for non-existent channel", () => {
      expect(() => manager.stopChannel("nonexistent")).not.toThrow();
    });
  });

  describe("stopAll()", () => {
    it("stops handles across all channels", () => {
      const h1 = manager.play("a", { channel: "sfx" });
      const h2 = manager.play("b", { channel: "music" });
      manager.stopAll();
      expect(h1.playing).toBe(false);
      expect(h2.playing).toBe(false);
    });
  });

  describe("setChannelVolume()", () => {
    it("recalculates volume on active handles", () => {
      const handle = manager.play("test", { volume: 0.8 });
      manager.setChannelVolume("sfx", 0.5);
      // 0.5 * 0.8 = 0.4
      expect(handle.volume).toBeCloseTo(0.4);
    });
  });

  describe("muteChannel() / unmuteChannel()", () => {
    it("mutes all handles in a channel", () => {
      const handle = manager.play("test");
      manager.muteChannel("sfx");
      expect(handle.muted).toBe(true);
    });

    it("unmutes all handles in a channel", () => {
      const handle = manager.play("test");
      manager.muteChannel("sfx");
      manager.unmuteChannel("sfx");
      expect(handle.muted).toBe(false);
    });
  });

  describe("pauseChannel() / resumeChannel()", () => {
    it("pauses all handles in a channel", () => {
      const handle = manager.play("test");
      manager.pauseChannel("sfx");
      expect(handle.paused).toBe(true);
    });

    it("resumes all handles in a channel", () => {
      const handle = manager.play("test");
      manager.pauseChannel("sfx");
      manager.resumeChannel("sfx");
      expect(handle.paused).toBe(false);
    });
  });

  describe("muteAll() / unmuteAll()", () => {
    it("muteAll mutes all channels and their handles", () => {
      const h1 = manager.play("a", { channel: "sfx" });
      const h2 = manager.play("b", { channel: "music" });
      manager.muteAll();
      expect(h1.muted).toBe(true);
      expect(h2.muted).toBe(true);
    });

    it("unmuteAll unmutes all channels and their handles", () => {
      const h1 = manager.play("a", { channel: "sfx" });
      const h2 = manager.play("b", { channel: "music" });
      manager.muteAll();
      manager.unmuteAll();
      expect(h1.muted).toBe(false);
      expect(h2.muted).toBe(false);
    });

    it("unmuteAll does not desync with per-channel mute", () => {
      manager.muteAll();
      manager.unmuteAll();
      manager.muteChannel("sfx");
      const handle = manager.play("test", { channel: "sfx" });
      expect(handle.muted).toBe(true);
    });
  });

  describe("auto-cleanup", () => {
    it("removes dead handles on end event", () => {
      const handle = manager.play("test");
      const inst = mockSound._instances.get("test")!;
      inst._emit("end");
      expect(handle.playing).toBe(false);
    });
  });

  describe("onEnd option", () => {
    it("calls onEnd once when the sound finishes (its end event)", () => {
      const onEnd = vi.fn();
      manager.play("test", { onEnd });
      const inst = mockSound._instances.get("test")!;
      expect(onEnd).not.toHaveBeenCalled();
      inst._emit("end");
      expect(onEnd).toHaveBeenCalledTimes(1);
    });

    it("does NOT call onEnd when the sound is stopped", () => {
      const onEnd = vi.fn();
      const handle = manager.play("test", { onEnd });
      handle.stop(); // emits the instance's `stop` event, not `end`
      expect(onEnd).not.toHaveBeenCalled();
    });

    it("attributes a throwing onEnd to the boundary and rethrows", () => {
      const boundary = new ErrorBoundary(new Logger({ level: LogLevel.Debug }));
      manager._setErrorBoundary(boundary);
      manager.play("test", {
        onEnd: () => {
          throw new Error("boom");
        },
      });

      const inst = mockSound._instances.get("test")!;
      expect(() => inst._emit("end")).toThrow("boom");

      const errors = boundary.getCallbackErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        kind: "Audio onEnd callback",
        error: "boom",
      });
    });

    it("lets a throwing onEnd propagate when no boundary is wired", () => {
      manager.play("test", {
        onEnd: () => {
          throw new Error("boom");
        },
      });
      const inst = mockSound._instances.get("test")!;
      expect(() => inst._emit("end")).toThrow("boom");
    });
  });

  describe("new handle inherits channel state", () => {
    it("applies channel mute to new handles", () => {
      manager.muteChannel("sfx");
      const handle = manager.play("test");
      expect(handle.muted).toBe(true);
    });

    it("applies channel pause to new handles", () => {
      manager.pauseChannel("sfx");
      const handle = manager.play("test");
      expect(handle.paused).toBe(true);
    });
  });

  describe("isUnlocked()", () => {
    it("returns true when AudioContext is running", () => {
      const s = createMockSoundLibrary({ state: "running" });
      const m = new AudioManager(s);
      expect(m.isUnlocked()).toBe(true);
    });

    it("returns false when AudioContext is suspended", () => {
      const s = createMockSoundLibrary({ state: "suspended" });
      const m = new AudioManager(s);
      expect(m.isUnlocked()).toBe(false);
    });
  });

  describe("onUnlock()", () => {
    it("fires synchronously if already unlocked", () => {
      const s = createMockSoundLibrary({ state: "running" });
      const m = new AudioManager(s);
      const cb = vi.fn();
      m.onUnlock(cb);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("queues listener while suspended and fires on gesture when state flips", () => {
      const s = createMockSoundLibrary({ state: "suspended" });
      const m = new AudioManager(s);
      const cb = vi.fn();
      m.onUnlock(cb);
      // Gesture arrives but context is still suspended
      m._handleGesture();
      expect(cb).not.toHaveBeenCalled();
      // Browser resumes context (e.g. @pixi/sound's _unlock ran)
      setAudioContextState(s, "running");
      m._handleGesture();
      expect(cb).toHaveBeenCalledTimes(1);
      // Idempotent
      m._handleGesture();
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("returned disposer removes a pending listener", () => {
      const s = createMockSoundLibrary({ state: "suspended" });
      const m = new AudioManager(s);
      const cb = vi.fn();
      const dispose = m.onUnlock(cb);
      dispose();
      setAudioContextState(s, "running");
      m._handleGesture();
      expect(cb).not.toHaveBeenCalled();
    });

    it("offUnlock removes a pending listener", () => {
      const s = createMockSoundLibrary({ state: "suspended" });
      const m = new AudioManager(s);
      const cb = vi.fn();
      m.onUnlock(cb);
      m.offUnlock(cb);
      setAudioContextState(s, "running");
      m._handleGesture();
      expect(cb).not.toHaveBeenCalled();
    });

    it("fires all queued listeners in order", () => {
      const s = createMockSoundLibrary({ state: "suspended" });
      const m = new AudioManager(s);
      const order: number[] = [];
      m.onUnlock(() => order.push(1));
      m.onUnlock(() => order.push(2));
      setAudioContextState(s, "running");
      m._handleGesture();
      expect(order).toEqual([1, 2]);
    });

    it("a throwing listener does not poison the rest of the queue", () => {
      const s = createMockSoundLibrary({ state: "suspended" });
      const m = new AudioManager(s);
      const after = vi.fn();
      m.onUnlock(() => {
        throw new Error("boom");
      });
      m.onUnlock(after);
      setAudioContextState(s, "running");
      m._handleGesture();
      expect(after).toHaveBeenCalledTimes(1);
    });

    it("sync-path (already unlocked) also swallows a throwing listener", () => {
      const s = createMockSoundLibrary({ state: "running" });
      const m = new AudioManager(s);
      expect(() =>
        m.onUnlock(() => {
          throw new Error("boom");
        }),
      ).not.toThrow();
    });

    describe("with an error boundary wired", () => {
      it("reports and rethrows a throwing queued listener, leaving the rest of the queue unrun", () => {
        const s = createMockSoundLibrary({ state: "suspended" });
        const m = new AudioManager(s);
        const logger = new Logger({ level: LogLevel.Debug });
        const boundary = new ErrorBoundary(logger);
        m._setErrorBoundary(boundary);
        const after = vi.fn();

        m.onUnlock(() => {
          throw new Error("boom");
        });
        m.onUnlock(after);
        setAudioContextState(s, "running");

        expect(() => m._handleGesture()).toThrow("boom");

        expect(after).not.toHaveBeenCalled();
        const errors = boundary.getCallbackErrors();
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
          kind: "Audio unlock callback",
          error: "boom",
        });
      });

      it("reports and rethrows a throwing listener on the synchronous (already-unlocked) path", () => {
        const s = createMockSoundLibrary({ state: "running" });
        const m = new AudioManager(s);
        const logger = new Logger({ level: LogLevel.Debug });
        const boundary = new ErrorBoundary(logger);
        m._setErrorBoundary(boundary);

        expect(() =>
          m.onUnlock(() => {
            throw new Error("boom");
          }),
        ).toThrow("boom");
        expect(boundary.getCallbackErrors()).toHaveLength(1);
      });
    });
  });

  describe("autoMuteOnBlur", () => {
    function getAutoPause(s: MockSoundLibrary): boolean {
      return (s.context as unknown as { autoPause: boolean }).autoPause;
    }

    it("defaults to true", () => {
      const s = createMockSoundLibrary();
      const m = new AudioManager(s);
      expect(m.autoMuteOnBlur).toBe(true);
    });

    it("propagates the initial value to context.autoPause", () => {
      const s = createMockSoundLibrary({ autoPause: true });
      new AudioManager(s, { autoMuteOnBlur: false });
      expect(getAutoPause(s)).toBe(false);
    });

    it("setter writes through to context.autoPause", () => {
      const s = createMockSoundLibrary();
      const m = new AudioManager(s);
      expect(getAutoPause(s)).toBe(true);
      m.autoMuteOnBlur = false;
      expect(getAutoPause(s)).toBe(false);
      m.autoMuteOnBlur = true;
      expect(getAutoPause(s)).toBe(true);
    });
  });
});
