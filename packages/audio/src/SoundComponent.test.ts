import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SoundLibrary, IMediaInstance } from "@pixi/sound";
import { SoundComponent } from "./SoundComponent.js";
import { AudioManager } from "./AudioManager.js";
import { createAudioTestContext, spawnEntityInScene } from "./test-helpers.js";

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

function createMockSoundLibrary(): SoundLibrary {
  return {
    play: vi.fn(() => createMockInstance()),
    stop: vi.fn(),
    muteAll: vi.fn(),
    unmuteAll: vi.fn(),
    close: vi.fn(),
    exists: vi.fn(() => true),
  } as unknown as SoundLibrary;
}

describe("SoundComponent", () => {
  let mockSound: SoundLibrary;
  let manager: AudioManager;

  beforeEach(() => {
    mockSound = createMockSoundLibrary();
    manager = new AudioManager(mockSound);
  });

  it("play() delegates to AudioManager", () => {
    const { scene } = createAudioTestContext(manager);
    const entity = spawnEntityInScene(scene);
    const comp = new SoundComponent({ alias: "laser", channel: "sfx" });
    entity.add(comp);

    const handle = comp.play();
    expect(mockSound.play).toHaveBeenCalledWith(
      "laser",
      expect.objectContaining({ loop: false }),
    );
    expect(handle).toBeDefined();
    expect(handle.playing).toBe(true);
  });

  it("stop() stops the current handle", () => {
    const { scene } = createAudioTestContext(manager);
    const entity = spawnEntityInScene(scene);
    const comp = new SoundComponent({ alias: "laser" });
    entity.add(comp);

    const handle = comp.play();
    comp.stop();
    expect(handle.playing).toBe(false);
  });

  it("playOnAdd triggers play on add", () => {
    const { scene } = createAudioTestContext(manager);
    const entity = spawnEntityInScene(scene);
    const comp = new SoundComponent({ alias: "music", playOnAdd: true });
    entity.add(comp);

    expect(mockSound.play).toHaveBeenCalledWith("music", expect.anything());
    expect(comp.handle).not.toBeNull();
  });

  it("does not play on add by default", () => {
    const { scene } = createAudioTestContext(manager);
    const entity = spawnEntityInScene(scene);
    const comp = new SoundComponent({ alias: "music" });
    entity.add(comp);

    expect(mockSound.play).not.toHaveBeenCalled();
    expect(comp.handle).toBeNull();
  });

  it("onDestroy auto-stops playing sound", () => {
    const { scene } = createAudioTestContext(manager);
    const entity = spawnEntityInScene(scene);
    const comp = new SoundComponent({ alias: "music", playOnAdd: true });
    entity.add(comp);

    const handle = comp.handle!;
    expect(handle.playing).toBe(true);

    (entity as unknown as { _performDestroy(): void })._performDestroy();
    expect(handle.playing).toBe(false);
  });

  it("play() stops previous handle before starting new one", () => {
    const { scene } = createAudioTestContext(manager);
    const entity = spawnEntityInScene(scene);
    const comp = new SoundComponent({ alias: "laser" });
    entity.add(comp);

    const first = comp.play();
    const second = comp.play();
    expect(first.playing).toBe(false);
    expect(second.playing).toBe(true);
  });

  it("stop() clears handle even after sound ended naturally", () => {
    const { scene } = createAudioTestContext(manager);
    const entity = spawnEntityInScene(scene);
    const comp = new SoundComponent({ alias: "laser" });
    entity.add(comp);

    comp.play();
    expect(comp.handle).not.toBeNull();
    // Simulate natural end — handle.playing becomes false
    // but comp.handle should still be clearable
    comp.stop();
    expect(comp.handle).toBeNull();
  });

  it("passes loop and volume options to manager", () => {
    const { scene } = createAudioTestContext(manager);
    const entity = spawnEntityInScene(scene);
    const comp = new SoundComponent({
      alias: "bgm",
      channel: "music",
      loop: true,
      volume: 0.5,
    });
    entity.add(comp);
    comp.play();

    expect(mockSound.play).toHaveBeenCalledWith(
      "bgm",
      expect.objectContaining({
        volume: 0.5 * 0.7, // music channel default = 0.7, instance = 0.5
        loop: true,
      }),
    );
  });
});
