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

function createMockSoundLibrary(): MockSoundLibrary {
  const instances = new Map<string, MockMediaInstance>();
  let nextId = 1;

  return {
    _instances: instances,
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
});
