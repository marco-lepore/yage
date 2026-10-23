import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { AssetManager, AssetManagerKey, EngineContext } from "@yagejs/core";
import { AudioPlugin } from "./AudioPlugin.js";
import { AudioManagerKey } from "./types.js";
import { clearRegisteredSounds, getSound, sound } from "./assets.js";
import { FakeAudioContext, fakeBuffer } from "./test-helpers.js";
beforeEach(clearRegisteredSounds);
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
it("releases the sounds its loader registered, so a later engine loads them again", async () => {
  class Context extends FakeAudioContext {
    decodeAudioData = vi.fn().mockResolvedValue(fakeBuffer(1));
  }
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(44)),
    }),
  );
  const coin = sound("/sfx/coin.wav");
  const boot = async (): Promise<AudioPlugin> => {
    const assets = new AssetManager();
    const engine = new EngineContext();
    engine.register(AssetManagerKey, assets);
    const plugin = new AudioPlugin();
    plugin.install(engine);
    await assets.loadAll([coin]);
    return plugin;
  };
  const first = await boot();
  expect(getSound(coin.path)).toBeDefined();
  first.onDestroy();
  expect(getSound(coin.path)).toBeUndefined();
  const second = await boot();
  expect(getSound(coin.path)).toBeDefined();
  second.onDestroy();
});
it("lets two engines preload one file and unload it in either order", async () => {
  class Context extends FakeAudioContext {
    decodeAudioData = vi.fn(() => Promise.resolve(fakeBuffer(1)));
  }
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(44)),
      }),
    ),
  );
  const coin = sound("/sfx/coin.wav", { rootNote: 72 });
  const boot = async (): Promise<{
    assets: AssetManager;
    plugin: AudioPlugin;
  }> => {
    const booted = bootWithLoader();
    await booted.assets.loadAll([coin]);
    return booted;
  };
  // The engine that loaded the file first releases it first: an unload,
  // then the other engine's destroy.
  let first = await boot();
  let second = await boot();
  const shared = getSound(coin.path);
  expect(first.assets.get(coin)).toBe(shared);
  expect(second.assets.get(coin)).toBe(shared);
  await first.assets.unload(coin);
  expect(getSound(coin.path)).toBe(shared);
  second.plugin.onDestroy();
  expect(getSound(coin.path)).toBeUndefined();
  first.plugin.onDestroy();

  // The engine that loaded it second releases it first: a destroy, then the
  // other engine's unload.
  first = await boot();
  second = await boot();
  second.plugin.onDestroy();
  expect(getSound(coin.path)).toBe(first.assets.get(coin));
  await first.assets.unload(coin);
  expect(getSound(coin.path)).toBeUndefined();
  first.plugin.onDestroy();
});
it("rejects a second engine's load of a file with different metadata", async () => {
  class Context extends FakeAudioContext {
    decodeAudioData = vi.fn(() => Promise.resolve(fakeBuffer(1)));
  }
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(44)),
      }),
    ),
  );
  const a = bootWithLoader();
  const b = bootWithLoader();
  await a.assets.loadAll([sound("/sfx/pad.wav", { rootNote: 60 })]);
  await expect(
    b.assets.loadAll([sound("/sfx/pad.wav", { rootNote: 57 })]),
  ).rejects.toThrow('Audio asset "/sfx/pad.wav": another engine loaded');
  a.plugin.onDestroy();
  b.plugin.onDestroy();
  expect(getSound("/sfx/pad.wav")).toBeUndefined();
});
it("resumes on a gesture and suspends while the page is hidden", async () => {
  vi.useFakeTimers();
  class Context extends FakeAudioContext {
    override state: AudioContextState = "suspended";
  }
  const page = Object.assign(new EventTarget(), {
    hidden: false,
    hasFocus: () => true,
  });
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", new EventTarget());
  const engine = new EngineContext();
  const plugin = new AudioPlugin();
  plugin.install(engine);
  const manager = engine.resolve(AudioManagerKey);
  const unlocked = vi.fn();
  manager.onUnlock(unlocked);
  expect(manager.isUnlocked()).toBe(false);

  page.dispatchEvent(new Event("pointerdown"));
  page.dispatchEvent(new Event("keydown"));
  await vi.runOnlyPendingTimersAsync();
  expect(manager.isUnlocked()).toBe(true);
  expect(unlocked).toHaveBeenCalledOnce();

  page.hidden = true;
  page.dispatchEvent(new Event("visibilitychange"));
  await vi.runOnlyPendingTimersAsync();
  expect(manager.isUnlocked()).toBe(false);
  page.hidden = false;
  page.dispatchEvent(new Event("visibilitychange"));
  await vi.runOnlyPendingTimersAsync();
  expect(manager.isUnlocked()).toBe(true);
  plugin.onDestroy();
});
function bootWithLoader(): { assets: AssetManager; plugin: AudioPlugin } {
  const assets = new AssetManager();
  const engine = new EngineContext();
  engine.register(AssetManagerKey, assets);
  const plugin = new AudioPlugin();
  plugin.install(engine);
  return { assets, plugin };
}
it("rejects a failed download and registers nothing", async () => {
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
  const { assets, plugin } = bootWithLoader();
  const missing = sound("/sfx/missing.wav");
  await expect(assets.loadAll([missing])).rejects.toThrow("HTTP 404");
  expect(getSound(missing.path)).toBeUndefined();
  plugin.onDestroy();
});
it("rejects audio the browser cannot decode and registers nothing", async () => {
  class Context extends FakeAudioContext {
    decodeAudioData = vi.fn().mockRejectedValue(new Error("not audio"));
  }
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
    }),
  );
  const { assets, plugin } = bootWithLoader();
  const corrupt = sound("/sfx/corrupt.wav");
  await expect(assets.loadAll([corrupt])).rejects.toThrow("not audio");
  expect(getSound(corrupt.path)).toBeUndefined();
  plugin.onDestroy();
});
it("rejects a load that finishes after the plugin is destroyed", async () => {
  class Context extends FakeAudioContext {
    decodeAudioData = vi.fn().mockResolvedValue(fakeBuffer(1));
  }
  vi.stubGlobal("AudioContext", Context);
  let respond!: (response: unknown) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    ),
  );
  const { assets, plugin } = bootWithLoader();
  const late = sound("/sfx/late.wav");
  const loading = assets.loadAll([late]);
  plugin.onDestroy();
  respond({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });
  await expect(loading).rejects.toThrow("destroyed during load");
  expect(getSound(late.path)).toBeUndefined();
});
