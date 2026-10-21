import { afterEach, it, expect, vi } from "vitest";
import { EngineContext } from "@yagejs/core";
import { AudioPlugin } from "./AudioPlugin.js";
import { AudioManagerKey } from "./types.js";
import { FakeAudioContext } from "./test-helpers.js";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("owns the context and timer, and releases both on destroy", () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", FakeAudioContext);
  const engine = new EngineContext();
  const plugin = new AudioPlugin();
  plugin.install(engine);
  const manager = engine.resolve(AudioManagerKey);
  const tick = vi.fn();
  manager.addScheduler(tick);
  vi.advanceTimersByTime(25);
  expect(tick).toHaveBeenCalledOnce();
  plugin.onDestroy();
  vi.advanceTimersByTime(100);
  expect(tick).toHaveBeenCalledOnce();
  expect(manager.getDiagnostics().state).toBe("closed");
});
it("reports unsupported environments explicitly", () => {
  vi.stubGlobal("AudioContext", undefined);
  expect(() => new AudioPlugin().install(new EngineContext())).toThrow(
    "unavailable",
  );
});
