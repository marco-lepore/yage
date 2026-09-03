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
    await expect(am.loadAll([handle])).rejects.toThrow(
      /No loader.*font.*Missing plugin/,
    );
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

  // ---------- reference counting ----------

  it("keeps a shared asset alive until the last reference is released", async () => {
    const loader = fakeLoader((p) => `loaded:${p}`);
    am.registerLoader("texture", loader);

    // Two "scenes" preload the same handle — one load, two references.
    const sceneA = new AssetHandle<string>("texture", "shared.png");
    const sceneB = new AssetHandle<string>("texture", "shared.png");
    await am.loadAll([sceneA]);
    await am.loadAll([sceneB]);
    expect(loader.load).toHaveBeenCalledTimes(1);

    // First unload only decrements — the asset is still held by scene B.
    am.unload(sceneA);
    expect(am.has(sceneA)).toBe(true);
    expect(loader.unload).not.toHaveBeenCalled();

    // Last unload actually frees it.
    am.unload(sceneB);
    expect(am.has(sceneB)).toBe(false);
    expect(loader.unload).toHaveBeenCalledTimes(1);
  });

  it("counts a handle once per loadAll call, even if listed twice", async () => {
    const loader = fakeLoader((p) => `loaded:${p}`);
    am.registerLoader("texture", loader);

    const handle = new AssetHandle<string>("texture", "a.png");
    // Duplicate within one call loads once and takes a single reference.
    await am.loadAll([handle, handle]);
    expect(loader.load).toHaveBeenCalledTimes(1);

    am.unload(handle);
    expect(am.has(handle)).toBe(false);
    expect(loader.unload).toHaveBeenCalledTimes(1);
  });

  it("clear() frees shared assets regardless of reference count", async () => {
    const loader = fakeLoader((p) => `loaded:${p}`);
    am.registerLoader("texture", loader);

    const handle = new AssetHandle<string>("texture", "a.png");
    await am.loadAll([handle]);
    await am.loadAll([handle]); // refcount 2

    am.clear();

    expect(am.has(handle)).toBe(false);
    expect(loader.unload).toHaveBeenCalledTimes(1);
  });

  it("a reference taken after clear() reloads and unloads independently", async () => {
    const loader = fakeLoader((p) => `loaded:${p}`);
    am.registerLoader("texture", loader);

    const handle = new AssetHandle<string>("texture", "a.png");
    await am.loadAll([handle]);
    am.clear();

    // Count was reset by clear — a fresh load reloads, and one unload frees it.
    await am.loadAll([handle]);
    expect(loader.load).toHaveBeenCalledTimes(2);
    am.unload(handle);
    expect(am.has(handle)).toBe(false);
    expect(loader.unload).toHaveBeenCalledTimes(2);
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

  it("counts nothing for a failed loadAll, so a retry frees with one unload", async () => {
    let failing = true;
    const loader: AssetLoader<string> = {
      load: vi.fn(async (path: string) => {
        if (path === "b.png" && failing) throw new Error("network");
        return `loaded:${path}`;
      }),
      unload: vi.fn(),
    };
    am.registerLoader("texture", loader);

    const handles = ["a.png", "b.png", "c.png"].map(
      (path) => new AssetHandle<string>("texture", path),
    );
    await expect(am.loadAll(handles)).rejects.toThrow("network");

    failing = false;
    await am.loadAll(handles);
    for (const handle of handles) am.unload(handle);

    expect(handles.map((handle) => am.has(handle))).toEqual([
      false,
      false,
      false,
    ]);
    expect(loader.unload).toHaveBeenCalledTimes(3);
  });

  // ---------- conflicting declarations ----------

  it("warns when a second declaration of one path carries different data", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loader = fakeLoader((p) => `loaded:${p}`);
    am.registerLoader("web-font", loader);

    const plain = new AssetHandle<string>("web-font", "Inter.woff2", {
      family: "Inter",
    });
    const baked = new AssetHandle<string>("web-font", "Inter.woff2", {
      family: "Inter",
      bitmap: { size: 24 },
    });
    await am.loadAll([plain]);
    await am.loadAll([baked]);
    await am.loadAll([baked]);

    expect(loader.load).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("Inter.woff2");
    expect(warn.mock.calls[0]?.[0]).toContain('"bitmap":{"size":24}');
    warn.mockRestore();
  });

  it("warns when one call declares the same path twice with different data", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loader = fakeLoader((p) => `loaded:${p}`);
    am.registerLoader("web-font", loader);

    // A manifest composed from two modules that both declare the same font.
    await am.loadAll([
      new AssetHandle<string>("web-font", "Inter.woff2", { family: "Inter" }),
      new AssetHandle<string>("web-font", "Inter.woff2", {
        family: "Inter",
        bitmap: { size: 24 },
      }),
    ]);

    expect(loader.load).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("Inter.woff2");
    warn.mockRestore();
  });

  it("takes no references when a progress callback throws over a cached manifest", async () => {
    const loader = fakeLoader((p) => `loaded:${p}`);
    am.registerLoader("fake", loader);
    const handle = new AssetHandle<string>("fake", "a.dat");

    await am.loadAll([handle]);
    await expect(
      am.loadAll([handle], () => {
        throw new Error("progress blew up");
      }),
    ).rejects.toThrow("progress blew up");

    am.unload(handle);
    expect(am.has(handle)).toBe(false);
  });

  it("stays quiet when two declarations of one path agree", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loader = fakeLoader((p) => `loaded:${p}`);
    am.registerLoader("web-font", loader);

    // Same options, written in the other order.
    await am.loadAll([
      new AssetHandle<string>("web-font", "Inter.woff2", {
        family: "Inter",
        bitmap: true,
      }),
    ]);
    await am.loadAll([
      new AssetHandle<string>("web-font", "Inter.woff2", {
        bitmap: true,
        family: "Inter",
      }),
    ]);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
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
