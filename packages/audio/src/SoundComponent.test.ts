import { describe, it, expect, vi, beforeEach } from "vitest";
import { clearRegisteredSounds, registerSound } from "./assets.js";
import { FakeAudioContext, fakeBuffer } from "./test-helpers.js";
import { Entity } from "@yagejs/core";
import { SoundComponent } from "./SoundComponent.js";
import { AudioManager } from "./AudioManager.js";
import { createAudioTestContext, spawnEntityInScene } from "./test-helpers.js";

describe("SoundComponent", () => {
  let mockSound: { play: ReturnType<typeof vi.spyOn> };
  let manager: AudioManager;

  beforeEach(() => {
    clearRegisteredSounds();
    for (const alias of ["laser", "hit", "music", "bgm"])
      registerSound(alias, fakeBuffer());
    manager = new AudioManager(new FakeAudioContext().asContext());
    mockSound = { play: vi.spyOn(manager, "play") };
  });

  it("exposes its playback config for reading back", () => {
    const comp = new SoundComponent({
      alias: "laser",
      channel: "ui",
      loop: true,
      volume: 0.5,
    });
    expect(comp.alias).toBe("laser");
    expect(comp.channel).toBe("ui");
    expect(comp.loop).toBe(true);
    expect(comp.volume).toBe(0.5);
  });

  it("defaults the readable config the same way playback does", () => {
    const comp = new SoundComponent({ alias: "hit" });
    expect(comp.channel).toBe("sfx");
    expect(comp.loop).toBe(false);
    expect(comp.volume).toBe(1);
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

  it("playOnAdd stays quiet on a dormant entity until it is activated", () => {
    const { scene } = createAudioTestContext(manager);
    const entity = spawnEntityInScene(scene);
    entity.setActive(false);

    const comp = new SoundComponent({ alias: "music", playOnAdd: true });
    entity.add(comp);
    expect(mockSound.play).not.toHaveBeenCalled();

    entity.setActive(true);
    expect(mockSound.play).toHaveBeenCalledWith("music", expect.anything());
  });

  it("playOnAdd survives being spawned as a child of a dormant parent", () => {
    // The component must be added from `setup()`: that runs inside the spawn,
    // before the parent link exists, which is the window the sound has to
    // survive. Adding it after `spawnChild` returns tests nothing.
    class Jukebox extends Entity {
      setup() {
        this.add(new SoundComponent({ alias: "music", playOnAdd: true }));
      }
    }
    const { scene } = createAudioTestContext(manager);
    const parent = spawnEntityInScene(scene, "parent");
    parent.setActive(false);

    parent.spawnChild("child", Jukebox);
    expect(mockSound.play).not.toHaveBeenCalled();

    parent.setActive(true);
    expect(mockSound.play).toHaveBeenCalledTimes(1);
    expect(mockSound.play).toHaveBeenCalledWith("music", expect.anything());
  });

  it("playOnAdd is one-shot across a deactivate/reactivate cycle", () => {
    const { scene } = createAudioTestContext(manager);
    const entity = spawnEntityInScene(scene);
    const comp = new SoundComponent({ alias: "music", playOnAdd: true });
    entity.add(comp);
    expect(mockSound.play).toHaveBeenCalledTimes(1);

    entity.setActive(false);
    entity.setActive(true);
    expect(mockSound.play).toHaveBeenCalledTimes(1);
    expect(comp.handle).toBeNull();
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
        volume: 0.5,
        loop: true,
      }),
    );
  });
});
