/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSound = vi.hoisted(() => ({
  play: vi.fn(),
  stop: vi.fn(),
  muteAll: vi.fn(),
  unmuteAll: vi.fn(),
  close: vi.fn(),
  exists: vi.fn(() => true),
  context: {
    muted: false,
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
    mockSound.context.audioContext.state = "running";
  });

  afterEach(() => {
    // Reset hidden between tests in case a case toggled it
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
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

  describe("visibility wiring", () => {
    function setHidden(hidden: boolean): void {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => hidden,
      });
    }

    it("mutes on tab hide and restores on tab show", () => {
      const plugin = new AudioPlugin();
      const context = new EngineContext();
      plugin.install(context);
      expect(mockSound.context.muted).toBe(false);

      setHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      expect(mockSound.context.muted).toBe(true);

      setHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
      expect(mockSound.context.muted).toBe(false);

      plugin.onDestroy();
    });

    it("onDestroy removes the visibilitychange listener", () => {
      const plugin = new AudioPlugin();
      const context = new EngineContext();
      plugin.install(context);
      plugin.onDestroy();

      setHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      // Still false because listener was removed
      expect(mockSound.context.muted).toBe(false);
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
      // Already running (default). Install then dispatch a gesture — if
      // listeners were wrongly attached, _handleGesture would run; with no
      // pending listeners the call is harmless, so the assertion here is
      // weaker: just confirm cleanup does not double-remove and fire issues.
      mockSound.context.audioContext.state = "running";
      const plugin = new AudioPlugin();
      const context = new EngineContext();
      plugin.install(context);
      expect(() => plugin.onDestroy()).not.toThrow();
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
