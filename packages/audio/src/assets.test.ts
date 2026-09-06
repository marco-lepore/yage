import { describe, it, expect, vi, beforeEach } from "vitest";

// `@pixi/sound`'s singleton only runs in a real browser: it constructs an
// `AudioContext`, which Vitest's node and happy-dom environments do not
// provide. `AudioPlugin.install` is what loads it, so this fake `SoundLibrary`
// stands in for the module, the way `AudioPlugin.test.ts` mocks it too.
// `AudioManager` is constructed around the same fake so the round-trip test
// exercises the real ledger + `sound.add`/`find`/`exists`/`remove` contract,
// not just the mock's bookkeeping.
const { mockLibrary } = vi.hoisted(() => {
  const sounds = new Map<string, { alias: string; destroy: () => void }>();

  const add = vi.fn((alias: string, options: unknown) => {
    void options;
    const entry = { alias, destroy: vi.fn() };
    sounds.set(alias, entry);
    return entry;
  });
  const exists = vi.fn((alias: string) => sounds.has(alias));
  const find = vi.fn((alias: string) => sounds.get(alias));
  const remove = vi.fn((alias: string) => {
    sounds.get(alias)?.destroy();
    sounds.delete(alias);
  });
  const play = vi.fn(() => ({
    id: 1,
    progress: 0,
    paused: false,
    volume: 1,
    speed: 1,
    loop: false,
    muted: false,
    stop: vi.fn(),
    refresh: vi.fn(),
    refreshPaused: vi.fn(),
    init: vi.fn(),
    play: vi.fn(),
    destroy: vi.fn(),
    toString: vi.fn(() => ""),
    set: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }));

  return {
    mockLibrary: { sounds, add, exists, find, remove, play },
  };
});

vi.mock("@pixi/sound", () => ({ sound: mockLibrary }));

import { AudioManager } from "./AudioManager.js";
import {
  _setSoundLibrary,
  clearRegisteredSounds,
  registerSound,
  unregisterSound,
} from "./assets.js";

// The library reaches these functions from `AudioPlugin.install`, which loads
// it; nothing installs a plugin here, so the fake is handed over directly.
_setSoundLibrary(mockLibrary as never);

/** A stand-in `AudioBuffer` — never decoded, just an identity for the ledger. */
function makeBuffer(): AudioBuffer {
  return {} as AudioBuffer;
}

describe("registerSound() / unregisterSound()", () => {
  beforeEach(() => {
    clearRegisteredSounds();
    mockLibrary.sounds.clear();
    vi.clearAllMocks();
  });

  it("register→play round-trips through AudioManager without throwing", () => {
    const buffer = makeBuffer();
    registerSound("boom", buffer);
    // The call shape is the contract: `preload: true` makes `@pixi/sound`
    // decode an AudioBuffer source synchronously, which is what keeps
    // `AudioManager.play()` off its "not preloaded" throw.
    expect(mockLibrary.add).toHaveBeenCalledWith("boom", {
      source: buffer,
      preload: true,
    });
    const manager = new AudioManager(mockLibrary as never);
    expect(() => manager.play("boom")).not.toThrow();
    expect(mockLibrary.play).toHaveBeenCalledWith(
      "boom",
      expect.objectContaining({ volume: 1 }),
    );
  });

  it("re-registering an alias replaces the entry", () => {
    registerSound("boom", makeBuffer());
    const first = mockLibrary.find("boom");
    registerSound("boom", makeBuffer());
    const second = mockLibrary.find("boom");
    expect(second).not.toBe(first);
    expect(first?.destroy).toHaveBeenCalled();
  });

  it("registering over an alias it doesn't own throws, naming the alias", () => {
    // A loaded asset's alias (put there by the asset pipeline, not by
    // registerSound) must not be shadowed — its unload would destroy the
    // registered sound later.
    mockLibrary.add("music/theme.mp3", {});
    expect(() => registerSound("music/theme.mp3", makeBuffer())).toThrowError(
      /music\/theme\.mp3/,
    );
  });

  it("re-register throws and preserves an asset entry that overwrote the alias", () => {
    registerSound("shared", makeBuffer());
    // A later preload of the same alias: the asset pipeline overwrites the
    // library entry, so re-register now faces a foreign entry and must not
    // evict it.
    mockLibrary.add("shared", {});
    const assetEntry = mockLibrary.find("shared");
    expect(() => registerSound("shared", makeBuffer())).toThrowError(/shared/);
    expect(mockLibrary.find("shared")).toBe(assetEntry);
  });

  it("unregister removes the entry", () => {
    registerSound("boom", makeBuffer());
    unregisterSound("boom");
    expect(mockLibrary.exists("boom")).toBe(false);
  });

  it("unregister is a no-op for aliases it never registered", () => {
    // Including a loaded asset's entry — unregister must not evict it.
    mockLibrary.add("music/theme.mp3", {});
    expect(() => unregisterSound("music/theme.mp3")).not.toThrow();
    expect(() => unregisterSound("never-registered")).not.toThrow();
    expect(mockLibrary.exists("music/theme.mp3")).toBe(true);
  });

  it("unregister leaves an asset entry that overwrote the alias after registration", () => {
    registerSound("shared", makeBuffer());
    // A later preload of the same alias: the asset pipeline overwrites the
    // library entry (bypassing the ledger). unregister must not evict it.
    mockLibrary.add("shared", {});
    const assetEntry = mockLibrary.find("shared");
    unregisterSound("shared");
    expect(mockLibrary.find("shared")).toBe(assetEntry);
  });
});

describe("registering before AudioPlugin installs", () => {
  /**
   * A copy of the modules with nothing handed over yet: the slot the plugin
   * fills is module state, and the file above filled this file's copy.
   */
  async function freshModules(): Promise<{
    assets: typeof import("./assets.js");
    install: () => Promise<void>;
  }> {
    vi.resetModules();
    const [assets, { AudioPlugin }, { EngineContext }] = await Promise.all([
      import("./assets.js"),
      import("./AudioPlugin.js"),
      import("@yagejs/core"),
    ]);
    return {
      assets,
      install: () => new AudioPlugin().install(new EngineContext()),
    };
  }

  beforeEach(() => {
    mockLibrary.sounds.clear();
    vi.clearAllMocks();
  });

  it("adds the held sound to the library when the plugin installs", async () => {
    const { assets, install } = await freshModules();
    const buffer = makeBuffer();

    assets.registerSound("boom", buffer);
    expect(mockLibrary.exists("boom")).toBe(false);

    await install();

    expect(mockLibrary.exists("boom")).toBe(true);
    expect(mockLibrary.add).toHaveBeenCalledWith("boom", {
      source: buffer,
      preload: true,
    });
    expect(() =>
      new AudioManager(mockLibrary as never).play("boom"),
    ).not.toThrow();
  });

  it("drops a sound unregistered before the plugin installs", async () => {
    const { assets, install } = await freshModules();

    assets.registerSound("boom", makeBuffer());
    assets.unregisterSound("boom");

    await install();

    expect(mockLibrary.exists("boom")).toBe(false);
  });
});
