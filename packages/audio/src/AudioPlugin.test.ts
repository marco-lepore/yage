/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSound = vi.hoisted(() => ({
  play: vi.fn(),
  stop: vi.fn(),
  muteAll: vi.fn(),
  unmuteAll: vi.fn(),
  close: vi.fn(),
  exists: vi.fn(() => true),
  context: {
    muted: false,
    autoPause: true,
    paused: false,
    audioContext: { state: "running" as "suspended" | "running" },
  },
}));

vi.mock("@pixi/sound", () => ({
  sound: mockSound,
}));

import { EngineContext } from "@yagejs/core";
import { AudioPlugin } from "./AudioPlugin.js";
import { AudioManagerKey } from "./types.js";
import { AudioManager } from "./AudioManager.js";

describe("AudioPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSound.context.muted = false;
    mockSound.context.autoPause = true;
    mockSound.context.paused = false;
    mockSound.context.audioContext.state = "running";
  });

  it("has name 'audio'", () => {
    const plugin = new AudioPlugin();
    expect(plugin.name).toBe("audio");
  });

  it("has no dependencies", () => {
    const plugin = new AudioPlugin();
    expect((plugin as unknown as Record<string, unknown>).dependencies).toBeUndefined();
  });

  it("install() registers AudioManager on context", () => {
    const plugin = new AudioPlugin();
    const context = new EngineContext();
    plugin.install(context);

    const manager = context.resolve(AudioManagerKey);
    expect(manager).toBeInstanceOf(AudioManager);
    plugin.onDestroy();
  });

  it("onDestroy() calls sound.close()", () => {
    const plugin = new AudioPlugin();
    const context = new EngineContext();
    plugin.install(context);
    plugin.onDestroy();
    expect(mockSound.close).toHaveBeenCalled();
  });

  describe("autoMuteOnBlur runtime toggle", () => {
    function setHasFocus(value: boolean): void {
      Object.defineProperty(document, "hasFocus", {
        configurable: true,
        value: () => value,
      });
    }

    it("toggling off while window is unfocused resumes immediately", () => {
      mockSound.context.paused = true;
      const plugin = new AudioPlugin();
      const context = new EngineContext();
      plugin.install(context);
      const manager = context.resolve(AudioManagerKey);

      setHasFocus(false);
      manager.autoMuteOnBlur = false;
      expect(mockSound.context.autoPause).toBe(false);
      expect(mockSound.context.paused).toBe(false);

      setHasFocus(true);
      plugin.onDestroy();
    });

    it("toggling on while window is unfocused pauses immediately", () => {
      const plugin = new AudioPlugin({ autoMuteOnBlur: false });
      const context = new EngineContext();
      plugin.install(context);
      const manager = context.resolve(AudioManagerKey);

      setHasFocus(false);
      manager.autoMuteOnBlur = true;
      expect(mockSound.context.autoPause).toBe(true);
      expect(mockSound.context.paused).toBe(true);

      setHasFocus(true);
      plugin.onDestroy();
    });

    it("toggling while focused does not touch paused state", () => {
      const plugin = new AudioPlugin();
      const context = new EngineContext();
      plugin.install(context);
      const manager = context.resolve(AudioManagerKey);

      setHasFocus(true);
      manager.autoMuteOnBlur = false;
      expect(mockSound.context.paused).toBe(false);

      plugin.onDestroy();
    });
  });

  describe("unlock gesture wiring", () => {
    it("fires onUnlock listeners once the context reports running", () => {
      mockSound.context.audioContext.state = "suspended";
      const plugin = new AudioPlugin();
      const context = new EngineContext();
      plugin.install(context);
      const manager = context.resolve(AudioManagerKey);

      const cb = vi.fn();
      manager.onUnlock(cb);
      expect(cb).not.toHaveBeenCalled();

      // Simulate @pixi/sound's capture-phase unlock having already run by the
      // time our bubble-phase handler sees the event.
      mockSound.context.audioContext.state = "running";
      document.dispatchEvent(new Event("pointerdown"));
      expect(cb).toHaveBeenCalledTimes(1);

      plugin.onDestroy();
    });

    it("skips gesture listeners if already unlocked at install", () => {
      mockSound.context.audioContext.state = "running";
      const addSpy = vi.spyOn(document, "addEventListener");

      const plugin = new AudioPlugin();
      const context = new EngineContext();
      plugin.install(context);

      const gestureEvents = new Set(["pointerdown", "keydown", "touchstart"]);
      const attachedGestureCalls = addSpy.mock.calls.filter((args) =>
        gestureEvents.has(args[0] as string),
      );
      expect(attachedGestureCalls).toEqual([]);

      addSpy.mockRestore();
      plugin.onDestroy();
    });

    it("removes gesture listeners after first successful unlock", () => {
      mockSound.context.audioContext.state = "suspended";
      const plugin = new AudioPlugin();
      const context = new EngineContext();
      plugin.install(context);
      const manager = context.resolve(AudioManagerKey);

      mockSound.context.audioContext.state = "running";
      document.dispatchEvent(new Event("pointerdown"));

      // Register a new listener after unlock — should fire synchronously,
      // proving the state is now tracked as unlocked without needing another
      // gesture.
      const cb = vi.fn();
      manager.onUnlock(cb);
      expect(cb).toHaveBeenCalledTimes(1);

      plugin.onDestroy();
    });
  });
});
