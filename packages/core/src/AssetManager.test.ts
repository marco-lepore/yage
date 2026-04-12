import { describe, it, expect, vi, beforeEach } from "vitest";
import { AssetManager } from "./AssetManager.js";
import { AssetHandle } from "./AssetHandle.js";
import type { AssetLoader } from "./AssetHandle.js";

describe("AssetManager", () => {
  let am: AssetManager;

  beforeEach(() => {
    am = new AssetManager();
  });

  function fakeLoader<T>(factory: (path: string) => T): AssetLoader<T> {
    return {
      load: vi.fn(async (path: string) => factory(path)),
      unload: vi.fn(),
    };
  }

  // ---------- registerLoader / get / has ----------

  it("get() throws when asset is not loaded", () => {
    const handle = new AssetHandle<string>("texture", "foo.png");
    expect(() => am.get(handle)).toThrow(/not loaded.*foo\.png/);
  });

  it("has() returns false for unloaded asset", () => {
    const handle = new AssetHandle<string>("texture", "foo.png");
    expect(am.has(handle)).toBe(false);
  });

  // ---------- loadAll ----------

  it("loads assets and makes them available via get()", async () => {
    const loader = fakeLoader((p) => `loaded:${p}`);
    am.registerLoader("texture", loader);

    const h1 = new AssetHandle<string>("texture", "a.png");
    const h2 = new AssetHandle<string>("texture", "b.png");

    await am.loadAll([h1, h2]);

    expect(am.get(h1)).toBe("loaded:a.png");
    expect(am.get(h2)).toBe("loaded:b.png");
    expect(am.has(h1)).toBe(true);
    expect(am.has(h2)).toBe(true);
  });

  it("skips already-cached assets", async () => {
    const loader = fakeLoader((p) => `loaded:${p}`);
    am.registerLoader("texture", loader);

    const handle = new AssetHandle<string>("texture", "a.png");
    await am.loadAll([handle]);
    await am.loadAll([handle]); // second call

    expect(loader.load).toHaveBeenCalledTimes(1);
  });

  it("throws when no loader is registered for a type", async () => {
    const handle = new AssetHandle<string>("font", "my.ttf");
    await expect(am.loadAll([handle])).rejects.toThrow(/No loader.*font.*Missing plugin/);
  });

  it("reports progress via callback", async () => {
    const loader = fakeLoader((p) => p);
    am.registerLoader("texture", loader);

    const handles = [
      new AssetHandle<string>("texture", "a.png"),
      new AssetHandle<string>("texture", "b.png"),
      new AssetHandle<string>("texture", "c.png"),
    ];

    const progress: number[] = [];
    await am.loadAll(handles, (ratio) => progress.push(ratio));

    expect(progress[0]).toBe(0);
    // Final call should be 1
    expect(progress[progress.length - 1]).toBeCloseTo(1);
    // Should have 4 calls: 0, 1/3, 2/3, 1
    expect(progress).toHaveLength(4);
  });

  it("reports progress=1 immediately when all cached", async () => {
    const loader = fakeLoader((p) => p);
    am.registerLoader("texture", loader);

    const handle = new AssetHandle<string>("texture", "a.png");
    await am.loadAll([handle]);

    const progress: number[] = [];
    await am.loadAll([handle], (ratio) => progress.push(ratio));

    expect(progress).toEqual([1]);
  });

  it("loads multiple types in parallel", async () => {
    const texLoader = fakeLoader((p) => `tex:${p}`);
    const sndLoader = fakeLoader((p) => `snd:${p}`);
    am.registerLoader("texture", texLoader);
    am.registerLoader("sound", sndLoader);

    const tex = new AssetHandle<string>("texture", "player.png");
    const snd = new AssetHandle<string>("sound", "jump.wav");

    await am.loadAll([tex, snd]);

    expect(am.get(tex)).toBe("tex:player.png");
    expect(am.get(snd)).toBe("snd:jump.wav");
  });

  // ---------- unload ----------

  it("unload() removes from cache and calls loader.unload()", async () => {
    const loader = fakeLoader((p) => `loaded:${p}`);
    am.registerLoader("texture", loader);

    const handle = new AssetHandle<string>("texture", "a.png");
    await am.loadAll([handle]);
    expect(am.has(handle)).toBe(true);

    am.unload(handle);

    expect(am.has(handle)).toBe(false);
    expect(loader.unload).toHaveBeenCalledWith("a.png", "loaded:a.png");
  });

  it("unload() is a no-op for uncached handles", () => {
    const handle = new AssetHandle<string>("texture", "x.png");
    expect(() => am.unload(handle)).not.toThrow();
  });

  // ---------- clear ----------

  it("clear() unloads all cached assets", async () => {
    const loader = fakeLoader((p) => p);
    am.registerLoader("texture", loader);

    const h1 = new AssetHandle<string>("texture", "a.png");
    const h2 = new AssetHandle<string>("texture", "b.png");
    await am.loadAll([h1, h2]);

    am.clear();

    expect(am.has(h1)).toBe(false);
    expect(am.has(h2)).toBe(false);
    expect(loader.unload).toHaveBeenCalledTimes(2);
  });

  // ---------- key isolation ----------

  it("same path but different types are separate assets", async () => {
    const texLoader = fakeLoader(() => "TEX");
    const dataLoader = fakeLoader(() => "DATA");
    am.registerLoader("texture", texLoader);
    am.registerLoader("data", dataLoader);

    const tex = new AssetHandle<string>("texture", "shared.json");
    const data = new AssetHandle<string>("data", "shared.json");

    await am.loadAll([tex, data]);

    expect(am.get(tex)).toBe("TEX");
    expect(am.get(data)).toBe("DATA");
  });
});
