import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SoundLibrary, IMediaInstance } from "@pixi/sound";
import { AudioManager } from "./AudioManager.js";

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
  (s as unknown as { context: { audioContext: { state: string } } }).context.audioContext.state = state;
}

function createMockSoundLibrary(options?: {
  state?: "suspended" | "running";
  muted?: boolean;
}): MockSoundLibrary {
  const instances = new Map<string, MockMediaInstance>();
  let nextId = 1;

  const context = {
    muted: options?.muted ?? false,
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
  });

  describe("playRandom()", () => {
    it("plays one of the provided aliases", () => {
      const aliases = ["a", "b", "c"];
      manager.playRandom(aliases);
      const calledAlias = (mockSound.play as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as string;
      expect(aliases).toContain(calledAlias);
    });

    it("throws on empty aliases array", () => {
      expect(() => manager.playRandom([])).toThrow("must not be empty");
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
  });

  describe("autoMuteOnBlur", () => {
    it("defaults to true", () => {
      const s = createMockSoundLibrary();
      const m = new AudioManager(s);
      expect(m.autoMuteOnBlur).toBe(true);
    });

    it("mutes on hide and restores on show", () => {
      const s = createMockSoundLibrary({ muted: false });
      const m = new AudioManager(s);
      m._handleVisibilityChange(true);
      expect(s.context.muted).toBe(true);
      m._handleVisibilityChange(false);
      expect(s.context.muted).toBe(false);
    });

    it("restores the prior muted state, not a hard-unmute", () => {
      const s = createMockSoundLibrary({ muted: true });
      const m = new AudioManager(s);
      m._handleVisibilityChange(true);
      m._handleVisibilityChange(false);
      expect(s.context.muted).toBe(true);
    });

    it("no-op when disabled", () => {
      const s = createMockSoundLibrary({ muted: false });
      const m = new AudioManager(s, { autoMuteOnBlur: false });
      m._handleVisibilityChange(true);
      expect(s.context.muted).toBe(false);
    });

    it("toggling off mid-blur restores audio immediately", () => {
      const s = createMockSoundLibrary({ muted: false });
      const m = new AudioManager(s);
      m._handleVisibilityChange(true);
      expect(s.context.muted).toBe(true);
      m.autoMuteOnBlur = false;
      expect(s.context.muted).toBe(false);
    });

    it("does not double-snapshot across reentrant hides", () => {
      const s = createMockSoundLibrary({ muted: false });
      const m = new AudioManager(s);
      m._handleVisibilityChange(true);
      // Spurious second hide (e.g. browser quirks) should not clobber the
      // snapshot with the now-muted state, otherwise the restore would leave
      // audio muted on show.
      m._handleVisibilityChange(true);
      m._handleVisibilityChange(false);
      expect(s.context.muted).toBe(false);
    });
  });

});
