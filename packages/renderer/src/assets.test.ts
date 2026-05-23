import { describe, it, expect, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => {
  const assetsLoad = vi.fn(async () => undefined);
  const bitmapFontInstall = vi.fn();
  return {
    mocks: { assetsLoad, bitmapFontInstall },
  };
});

// `Rectangle` / `Texture` are imported by assets.ts but only used by the
// texture-slicing helpers, which these tests don't exercise — stub them as
// inert values so the named imports resolve.
vi.mock("pixi.js", () => ({
  Assets: { load: mocks.assetsLoad },
  BitmapFont: { install: mocks.bitmapFontInstall },
  Rectangle: {},
  Texture: {},
}));

import { AssetHandle } from "@yagejs/core";
import { bitmapFont, installBitmapFont } from "./assets.js";

describe("bitmapFont()", () => {
  it("creates a typed bitmap-font asset handle", () => {
    const handle = bitmapFont("fonts/pixel.fnt");
    expect(handle).toBeInstanceOf(AssetHandle);
    expect(handle.type).toBe("bitmap-font");
    expect(handle.path).toBe("fonts/pixel.fnt");
  });
});

describe("installBitmapFont()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the TTF and bakes a bitmap font, returning its name", async () => {
    const name = await installBitmapFont("fonts/PressStart2P.ttf", {
      name: "PressStart",
      size: 16,
    });

    expect(name).toBe("PressStart");
    expect(mocks.assetsLoad).toHaveBeenCalledWith({
      src: "fonts/PressStart2P.ttf",
      data: { family: "PressStart" },
    });
    expect(mocks.bitmapFontInstall).toHaveBeenCalledWith({
      name: "PressStart",
      style: { fill: 0xffffff, fontFamily: "PressStart", fontSize: 16 },
      resolution: 2,
      padding: 4,
    });
  });

  it("bakes a white atlas by default so per-text fill/tint can colour it", async () => {
    await installBitmapFont("a.ttf", { name: "A" });
    expect(mocks.bitmapFontInstall.mock.calls[0]?.[0].style.fill).toBe(0xffffff);
  });

  it("lets an explicit style.fill override the white default", async () => {
    await installBitmapFont("a.ttf", {
      name: "A",
      style: { fill: 0x00ff00 },
    });
    expect(mocks.bitmapFontInstall.mock.calls[0]?.[0].style.fill).toBe(0x00ff00);
  });

  it("defaults size/resolution/padding and merges extra style props", async () => {
    await installBitmapFont("a.ttf", {
      name: "A",
      style: { fill: 0xffffff, fontWeight: "bold" },
    });
    expect(mocks.bitmapFontInstall).toHaveBeenCalledWith({
      name: "A",
      style: { fill: 0xffffff, fontWeight: "bold", fontFamily: "A", fontSize: 32 },
      resolution: 2,
      padding: 4,
    });
  });

  it("accepts an asset handle and reads its path", async () => {
    const handle = bitmapFont("fonts/x.ttf");
    await installBitmapFont(handle, { name: "X" });
    expect(mocks.assetsLoad).toHaveBeenCalledWith({
      src: "fonts/x.ttf",
      data: { family: "X" },
    });
  });

  it("honors an explicit @font-face family override", async () => {
    await installBitmapFont("font.ttf", { name: "Hud", family: "Press Start 2P" });
    expect(mocks.assetsLoad).toHaveBeenCalledWith({
      src: "font.ttf",
      data: { family: "Press Start 2P" },
    });
    expect(mocks.bitmapFontInstall.mock.calls[0]?.[0].style).toMatchObject({
      fontFamily: "Press Start 2P",
    });
  });

  it("forwards chars only when provided", async () => {
    await installBitmapFont("a.ttf", { name: "A" });
    expect(mocks.bitmapFontInstall.mock.calls[0]?.[0]).not.toHaveProperty(
      "chars",
    );

    await installBitmapFont("b.ttf", {
      name: "B",
      chars: [["a", "z"], "0123456789 "],
    });
    expect(mocks.bitmapFontInstall.mock.calls[1]?.[0].chars).toEqual([
      ["a", "z"],
      "0123456789 ",
    ]);
  });
});
