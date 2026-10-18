// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Assets } from "pixi.js";
import { AssetManager } from "@yagejs/core";
import {
  dataTexture,
  dataTextureKey,
  loadDataTexture,
  unloadDataTexture,
} from "./dataTexture.js";

const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
afterEach(() => vi.unstubAllGlobals());

describe("numeric PNG imports", () => {
  it("uses explicit decoding, sampling, and resolution settings through asset ownership", async () => {
    const close = vi.fn();
    const decode = vi.fn().mockResolvedValue({ width: 64, height: 32, close });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(pngSignature)),
    );
    vi.stubGlobal("createImageBitmap", decode);
    const manager = new AssetManager();
    manager.registerLoader("data-texture", {
      load: loadDataTexture,
      unload: unloadDataTexture,
    });
    const handle = dataTexture("normal@2x.png", { scaleMode: "nearest" });
    await manager.loadAll([handle]);
    await manager.loadAll([handle]);
    const loaded = manager.get(handle);
    expect(decode).toHaveBeenCalledWith(expect.any(Blob), {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
      imageOrientation: "none",
    });
    expect(loaded.source.alphaMode).toBe("no-premultiply-alpha");
    expect(loaded.source.format).toBe("rgba8unorm");
    expect(loaded.source.scaleMode).toBe("nearest");
    expect(loaded.source.resolution).toBe(2);
    expect(loaded.width).toBe(32);
    expect(Assets.cache.has(handle.path)).toBe(false);
    expect(Assets.cache.get(dataTextureKey(handle.path))).toBe(loaded);
    await manager.unload(handle);
    expect(close).not.toHaveBeenCalled();
    await manager.unload(handle);
    expect(close).toHaveBeenCalledOnce();
    expect(loaded.destroyed).toBe(true);
    expect(Assets.cache.has(dataTextureKey(handle.path))).toBe(false);
  });

  it("rejects unsupported images before decode or cache writes", async () => {
    const decode = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not a PNG")),
    );
    vi.stubGlobal("createImageBitmap", decode);
    await expect(loadDataTexture("normal.jpg")).rejects.toThrow(/lossless PNG/);
    expect(decode).not.toHaveBeenCalled();
    expect(Assets.cache.has(dataTextureKey("normal.jpg"))).toBe(false);
  });

  it("rejects unavailable numeric decoding without a color-converting fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(pngSignature)),
    );
    vi.stubGlobal("createImageBitmap", undefined);
    await expect(loadDataTexture("normal.png")).rejects.toThrow(
      /without color conversion/,
    );
    expect(Assets.cache.has(dataTextureKey("normal.png"))).toBe(false);
  });
});
