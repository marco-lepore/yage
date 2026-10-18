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
    refreshPaused: vi.fn(),
    audioContext: { state: "running" as "suspended" | "running" },
  },
}));

vi.mock("@pixi/sound", () => ({
  sound: mockSound,
}));

import {
  EngineContext,
  EventBus,
  Host,
  HostKey,
  ProcessSystem,
  ProcessSystemKey,
} from "@yagejs/core";
import type { HostLifecycleReport } from "@yagejs/core";
import { AudioPlugin } from "./AudioPlugin.js";
import { AudioManagerKey } from "./types.js";
import { AudioManager } from "./AudioManager.js";

/** Every engine registers a `Host`; audio follows it. */
let host: Host | undefined;

function createContext(lifecycle?: HostLifecycleReport): EngineContext {
  const context = new EngineContext();
  context.register(ProcessSystemKey, new ProcessSystem());
  host = new Host();
  context.register(HostKey, host);
  host._connect({ events: new EventBus(), syncScenes: () => {} });
  if (lifecycle) setHost(lifecycle);
  return context;
}

/** Attach an adapter to the context's host and report a change through it. */
function setHost(state: HostLifecycleReport): void {
  const current = host;
  if (!current) throw new Error("no host in the context");
  if (reportToHost === undefined) {
    current.attach({
      info: { runtime: "test", os: "unknown" },
      watchLifecycle: (report) => {
        reportToHost = report;
        return () => {
          reportToHost = undefined;
        };
      },
    });
  }
  reportToHost?.(state);
}

let reportToHost: ((state: HostLifecycleReport) => void) | undefined;

describe("AudioPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    host?._dispose();
    host = undefined;
    reportToHost = undefined;
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
    expect(
      (plugin as unknown as Record<string, unknown>).dependencies,
    ).toBeUndefined();
  });

  it("install() registers AudioManager on context", async () => {
    const plugin = new AudioPlugin();
    const context = createContext();
    await plugin.install(context);

    const manager = context.resolve(AudioManagerKey);
    expect(manager).toBeInstanceOf(AudioManager);
    plugin.onDestroy();
  });

  it("onDestroy() calls sound.close()", async () => {
    const plugin = new AudioPlugin();
    const context = createContext();
    await plugin.install(context);
    plugin.onDestroy();
    expect(mockSound.close).toHaveBeenCalled();
  });

  it("registers nothing when destroyed while the library is loading", async () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const plugin = new AudioPlugin();
    const context = createContext();

    const installing = plugin.install(context);
    plugin.onDestroy();
    await installing;

    expect(context.tryResolve(AudioManagerKey)).toBeUndefined();
    expect(mockSound.close).toHaveBeenCalledTimes(1);
    const gestureEvents = new Set(["pointerdown", "keydown", "touchstart"]);
    expect(
      addSpy.mock.calls.filter((args) => gestureEvents.has(args[0])),
    ).toHaveLength(0);
    addSpy.mockRestore();
  });

  describe("following the host", () => {
    it("pauses the context when it installs under an inactive host", async () => {
      const plugin = new AudioPlugin();
      const context = createContext({ activity: "inactive" });

      await plugin.install(context);

      expect(mockSound.context.paused).toBe(true);
      expect(mockSound.context.autoPause).toBe(false);
      plugin.onDestroy();
    });

    it("pauses and resumes the context as the host changes", async () => {
      const plugin = new AudioPlugin();
      const context = createContext();
      await plugin.install(context);

      setHost({ activity: "inactive" });
      expect(mockSound.context.paused).toBe(true);

      setHost({ activity: "active" });
      expect(mockSound.context.paused).toBe(false);
      plugin.onDestroy();
    });

    it("leaves the context alone after it is destroyed", async () => {
      const plugin = new AudioPlugin();
      const context = createContext();
      await plugin.install(context);
      plugin.onDestroy();

      setHost({ activity: "inactive" });

      expect(mockSound.context.paused).toBe(false);
    });

    it("adds no page listener of its own", async () => {
      const plugin = new AudioPlugin();
      const context = createContext();
      const addSpy = vi.spyOn(document, "addEventListener");

      await plugin.install(context);

      const listened = addSpy.mock.calls.map((args) => args[0]);
      expect(listened).not.toContain("blur");
      expect(listened).not.toContain("focus");
      expect(listened).not.toContain("visibilitychange");
      addSpy.mockRestore();
      plugin.onDestroy();
    });

    it("registers no observer when it is destroyed while the library loads", async () => {
      const plugin = new AudioPlugin();
      const context = createContext();

      const installing = plugin.install(context);
      plugin.onDestroy();
      await installing;

      setHost({ activity: "inactive" });

      expect(mockSound.context.paused).toBe(false);
    });
  });

  describe("unlock gesture wiring", () => {
    it("fires onUnlock listeners once the context reports running", async () => {
      mockSound.context.audioContext.state = "suspended";
      const plugin = new AudioPlugin();
      const context = createContext();
      await plugin.install(context);
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

    it("skips gesture listeners if already unlocked at install", async () => {
      mockSound.context.audioContext.state = "running";
      const addSpy = vi.spyOn(document, "addEventListener");

      const plugin = new AudioPlugin();
      const context = createContext();
      await plugin.install(context);

      const gestureEvents = new Set(["pointerdown", "keydown", "touchstart"]);
      const attachedGestureCalls = addSpy.mock.calls.filter((args) =>
        gestureEvents.has(args[0] as string),
      );
      expect(attachedGestureCalls).toEqual([]);

      addSpy.mockRestore();
      plugin.onDestroy();
    });

    it("removes gesture listeners after first successful unlock", async () => {
      mockSound.context.audioContext.state = "suspended";
      const plugin = new AudioPlugin();
      const context = createContext();
      await plugin.install(context);
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
