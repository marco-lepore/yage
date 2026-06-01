import { describe, it, expect, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => {
  const assetsLoad = vi.fn(async () => undefined);
  // Mimic Pixi: each `BitmapFont.install` returns the installed font, whose
  // baked baseline metrics differ per emphasis (the #109 drift). The
  // installed-name counter gives the synthetic variants distinct baselines so
  // the normalization step has something to align.
  let baked = 0;
  const bitmapFontInstall = vi.fn(
    (options: {
      name: string;
      style: Record<string, unknown>;
      chars?: unknown;
    }) => {
      void options;
      baked += 1;
      return {
        name: options.name,
        baseLineOffset: 10 + baked,
        lineHeight: 30 + baked,
      };
    },
  );
  const assetsUnload = vi.fn(() => undefined);
  const bitmapFontUninstall = vi.fn((name: string) => void name);
  return {
    mocks: { assetsLoad, assetsUnload, bitmapFontInstall, bitmapFontUninstall },
  };
});

// `Rectangle` / `Texture` are imported by assets.ts but only used by the
// texture-slicing helpers, which these tests don't exercise — stub them as
// inert values so the named imports resolve.
vi.mock("pixi.js", () => ({
  Assets: { load: mocks.assetsLoad, unload: mocks.assetsUnload },
  BitmapFont: {
    install: mocks.bitmapFontInstall,
    uninstall: mocks.bitmapFontUninstall,
  },
  Rectangle: {},
  Texture: {},
}));

import { AssetHandle } from "@yagejs/core";
import {
  bitmapFont,
  clearBakedWebFontFamilies,
  installBitmapFont,
  loadWebFont,
  uninstallBitmapFont,
  unloadWebFont,
  webFont,
} from "./assets.js";
import {
  clearBitmapFontVariants,
  resolveBitmapFontVariant,
} from "./internal/bitmapFontVariants.js";
import { clearBakedFamilies } from "./internal/bitmapFontRegistry.js";

/** Reset every module-global font ledger so each test starts hermetic. */
function resetFontState(): void {
  clearBitmapFontVariants();
  clearBakedWebFontFamilies();
  clearBakedFamilies();
}

describe("bitmapFont()", () => {
  it("creates a typed bitmap-font asset handle", () => {
    const handle = bitmapFont("fonts/pixel.fnt");
    expect(handle).toBeInstanceOf(AssetHandle);
    expect(handle.type).toBe("bitmap-font");
    expect(handle.path).toBe("fonts/pixel.fnt");
  });
});

describe("webFont()", () => {
  it("creates a web-font handle carrying the family as loader data", () => {
    const handle = webFont("fonts/Inter.woff2", { family: "Inter" });
    expect(handle).toBeInstanceOf(AssetHandle);
    expect(handle.type).toBe("web-font");
    expect(handle.path).toBe("fonts/Inter.woff2");
    expect(handle.data).toEqual({ family: "Inter" });
  });

  it("omits data when no family is given (Pixi derives from the file name)", () => {
    const handle = webFont("fonts/Inter.woff2");
    expect(handle.data).toBeUndefined();
  });

  it("stashes the bitmap bake config alongside the family in loader data", () => {
    const handle = webFont("fonts/Inter.woff2", {
      family: "Inter",
      bitmap: { size: 24 },
    });
    expect(handle.data).toEqual({ family: "Inter", bitmap: { size: 24 } });
  });

  it("stashes a bare `bitmap: true` flag", () => {
    const handle = webFont("fonts/Inter.woff2", {
      family: "Inter",
      bitmap: true,
    });
    expect(handle.data).toEqual({ family: "Inter", bitmap: true });
  });
});

describe("web-font loader (loadWebFont / unloadWebFont)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFontState();
  });

  it("loads the face without baking when bitmap is unset", async () => {
    await loadWebFont("fonts/Inter.woff2", { family: "Inter" });
    expect(mocks.assetsLoad).toHaveBeenCalledWith({
      src: "fonts/Inter.woff2",
      data: { family: "Inter" },
    });
    expect(mocks.bitmapFontInstall).not.toHaveBeenCalled();
  });

  it("bakes a bitmap font under the same family when bitmap is set", async () => {
    await loadWebFont("fonts/Inter.woff2", {
      family: "Inter",
      bitmap: { size: 24 },
    });
    expect(mocks.assetsLoad).toHaveBeenCalledWith({
      src: "fonts/Inter.woff2",
      data: { family: "Inter" },
    });
    expect(mocks.bitmapFontInstall).toHaveBeenCalledWith({
      name: "Inter",
      style: { fill: 0xffffff, fontFamily: "Inter", fontSize: 24 },
      resolution: 2,
      padding: 4,
    });
  });

  it("bakes with defaults when bitmap is `true`", async () => {
    await loadWebFont("fonts/Inter.woff2", { family: "Inter", bitmap: true });
    expect(mocks.bitmapFontInstall).toHaveBeenCalledWith({
      name: "Inter",
      style: { fill: 0xffffff, fontFamily: "Inter", fontSize: 32 },
      resolution: 2,
      padding: 4,
    });
  });

  it("bakes declared emphasis variants under derived names", async () => {
    await loadWebFont("fonts/Body.woff2", {
      family: "Body",
      bitmap: { variants: [{ fontWeight: "bold" }] },
    });
    const names = mocks.bitmapFontInstall.mock.calls.map((c) => c[0].name);
    expect(names).toEqual(["Body", "Body bold"]);
    expect(resolveBitmapFontVariant("Body", { fontWeight: "bold" })).toBe(
      "Body bold",
    );
  });

  it("skips the bake (with a warning) when no family is given", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await loadWebFont("fonts/Inter.woff2", { bitmap: true });
    expect(mocks.assetsLoad).toHaveBeenCalledWith("fonts/Inter.woff2");
    expect(mocks.bitmapFontInstall).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("uninstalls every baked atlas on unload alongside Assets.unload", async () => {
    await loadWebFont("fonts/Body.woff2", {
      family: "Body",
      bitmap: { variants: [{ fontWeight: "bold" }, { fontStyle: "italic" }] },
    });

    unloadWebFont("fonts/Body.woff2");

    expect(mocks.assetsUnload).toHaveBeenCalledWith("fonts/Body.woff2");
    const uninstalled = mocks.bitmapFontUninstall.mock.calls.map((c) => c[0]);
    expect(uninstalled).toEqual(["Body", "Body bold", "Body italic"]);
  });

  it("clears the variant registry on unload so resolution stops returning a destroyed atlas", async () => {
    await loadWebFont("fonts/Body.woff2", {
      family: "Body",
      bitmap: { variants: [{ fontWeight: "bold" }] },
    });
    expect(resolveBitmapFontVariant("Body", { fontWeight: "bold" })).toBe(
      "Body bold",
    );

    unloadWebFont("fonts/Body.woff2");

    // The family no longer hosts any variants — resolution returns undefined
    // rather than a name mapping to an uninstalled atlas.
    expect(
      resolveBitmapFontVariant("Body", { fontWeight: "bold" }),
    ).toBeUndefined();
  });

  it("unload of a plain web font drops the face but uninstalls no atlas", async () => {
    await loadWebFont("fonts/Inter.woff2", { family: "Inter" });

    unloadWebFont("fonts/Inter.woff2");

    expect(mocks.assetsUnload).toHaveBeenCalledWith("fonts/Inter.woff2");
    expect(mocks.bitmapFontUninstall).not.toHaveBeenCalled();
  });
});

describe("installBitmapFont()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFontState();
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

describe("installBitmapFont() variants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFontState();
  });

  it("bakes a sibling atlas per variant under a derived name", async () => {
    await installBitmapFont("Body.ttf", {
      name: "Body",
      variants: [{ fontWeight: "bold" }, { fontStyle: "italic" }],
    });

    const names = mocks.bitmapFontInstall.mock.calls.map((c) => c[0].name);
    expect(names).toEqual(["Body", "Body bold", "Body italic"]);
  });

  it("bakes each variant's emphasis into its atlas style", async () => {
    await installBitmapFont("Body.ttf", {
      name: "Body",
      variants: [{ fontWeight: "bold", fontStyle: "italic" }],
    });

    const variantCall = mocks.bitmapFontInstall.mock.calls.find(
      (c) => c[0].name === "Body bold italic",
    );
    expect(variantCall?.[0].style).toMatchObject({
      fontWeight: "bold",
      fontStyle: "italic",
      fontFamily: "Body",
    });
  });

  it("aligns every variant's baseline metrics to the base atlas (#109)", async () => {
    await installBitmapFont("Body.ttf", {
      name: "Body",
      variants: [{ fontWeight: "bold" }, { fontStyle: "italic" }],
    });

    // Each install returns a distinct baked baseline; after normalization the
    // variant fonts must share the base font's offset + line height so a
    // mixed-weight line sits on one baseline.
    const fonts = mocks.bitmapFontInstall.mock.results.map(
      (r) => r.value as { baseLineOffset: number; lineHeight: number },
    );
    const [base, bold, italic] = fonts;
    expect(bold?.baseLineOffset).toBe(base?.baseLineOffset);
    expect(italic?.baseLineOffset).toBe(base?.baseLineOffset);
    expect(bold?.lineHeight).toBe(base?.lineHeight);
    expect(italic?.lineHeight).toBe(base?.lineHeight);
  });

  it("registers variants so a bold/italic request resolves the right atlas", async () => {
    await installBitmapFont("Body.ttf", {
      name: "Body",
      variants: [{ fontWeight: "bold" }, { fontStyle: "italic" }],
    });

    expect(resolveBitmapFontVariant("Body", { fontWeight: "bold" })).toBe(
      "Body bold",
    );
    // Numeric weights map onto the bold axis.
    expect(resolveBitmapFontVariant("Body", { fontWeight: "700" })).toBe(
      "Body bold",
    );
    expect(resolveBitmapFontVariant("Body", { fontStyle: "italic" })).toBe(
      "Body italic",
    );
    // No emphasis resolves the base atlas.
    expect(resolveBitmapFontVariant("Body", {})).toBe("Body");
    expect(
      resolveBitmapFontVariant("Body", { fontWeight: "normal" }),
    ).toBe("Body");
  });

  it("falls back to the base atlas for an emphasis with no baked variant", async () => {
    await installBitmapFont("Body.ttf", {
      name: "Body",
      variants: [{ fontWeight: "bold" }],
    });

    // Only bold was baked — an italic request has no atlas, so resolution
    // returns the base rather than a phantom name.
    expect(resolveBitmapFontVariant("Body", { fontStyle: "italic" })).toBe(
      "Body",
    );
  });

  it("registers no variants when none are requested", async () => {
    await installBitmapFont("Body.ttf", { name: "Body" });
    expect(resolveBitmapFontVariant("Body", { fontWeight: "bold" })).toBeUndefined();
  });

  it("skips a variant that doesn't cross the bold/italic axis", async () => {
    await installBitmapFont("Body.ttf", {
      name: "Body",
      // "lighter" collapses onto the regular axis — it must not bake a second
      // atlas nor clobber the base registration (#115 review P1).
      variants: [{ fontWeight: "lighter" }, { fontWeight: "bold" }],
    });

    const names = mocks.bitmapFontInstall.mock.calls.map((c) => c[0].name);
    expect(names).toEqual(["Body", "Body bold"]);
    // Regular text still resolves the base atlas, not a phantom "Body bold".
    expect(resolveBitmapFontVariant("Body", {})).toBe("Body");
  });

  it("re-installing the same font name clears stale variant registrations", async () => {
    await installBitmapFont("Body.ttf", {
      name: "Body",
      variants: [{ fontWeight: "bold" }, { fontStyle: "italic" }],
    });
    expect(resolveBitmapFontVariant("Body", { fontWeight: "bold" })).toBe(
      "Body bold",
    );
    expect(resolveBitmapFontVariant("Body", { fontStyle: "italic" })).toBe(
      "Body italic",
    );

    // Re-install with a smaller variant set — the italic entry must NOT linger.
    await installBitmapFont("Body.ttf", {
      name: "Body",
      variants: [{ fontWeight: "bold" }],
    });

    expect(resolveBitmapFontVariant("Body", { fontWeight: "bold" })).toBe(
      "Body bold",
    );
    // Falls back to the base atlas now that italic is no longer registered,
    // instead of returning the orphaned "Body italic" name.
    expect(resolveBitmapFontVariant("Body", { fontStyle: "italic" })).toBe(
      "Body",
    );
  });
});

describe("bitmap-font teardown (ref-counted)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFontState();
  });

  it("uninstallBitmapFont frees the atlas, the source face, and the variant registry", async () => {
    await installBitmapFont("fonts/Press.ttf", {
      name: "Press",
      variants: [{ fontWeight: "bold" }],
    });
    expect(resolveBitmapFontVariant("Press", { fontWeight: "bold" })).toBe(
      "Press bold",
    );

    uninstallBitmapFont("Press");

    // Source face dropped, base + variant atlases uninstalled.
    expect(mocks.assetsUnload).toHaveBeenCalledWith("fonts/Press.ttf");
    expect(mocks.bitmapFontUninstall.mock.calls.map((c) => c[0])).toEqual([
      "Press",
      "Press bold",
    ]);
    // Variant registry cleared so resolution no longer points at a dead atlas.
    expect(
      resolveBitmapFontVariant("Press", { fontWeight: "bold" }),
    ).toBeUndefined();
  });

  it("uninstallBitmapFont is a no-op for a name that was never installed", () => {
    expect(() => uninstallBitmapFont("Nope")).not.toThrow();
    expect(mocks.bitmapFontUninstall).not.toHaveBeenCalled();
    expect(mocks.assetsUnload).not.toHaveBeenCalled();
  });

  it("re-installing the same name stays one owner (a single uninstall frees it)", async () => {
    await installBitmapFont("Body.ttf", {
      name: "Body",
      variants: [{ fontWeight: "bold" }],
    });
    await installBitmapFont("Body.ttf", {
      name: "Body",
      variants: [{ fontWeight: "bold" }],
    });

    uninstallBitmapFont("Body");

    const uninstalled = mocks.bitmapFontUninstall.mock.calls.map((c) => c[0]);
    expect(uninstalled).toContain("Body");
    expect(uninstalled).toContain("Body bold");
  });

  it("a webFont and an installBitmapFont sharing a family don't tear each other down", async () => {
    // Both register a bitmap font under the family "Inter".
    await installBitmapFont("fonts/Inter.ttf", { name: "Inter" });
    await loadWebFont("fonts/Inter.woff2", { family: "Inter", bitmap: true });

    // Unloading the web font must NOT uninstall the shared atlas — the install
    // still owns it. This is the regression the ref-count guards against.
    unloadWebFont("fonts/Inter.woff2");
    expect(mocks.assetsUnload).toHaveBeenCalledWith("fonts/Inter.woff2");
    expect(mocks.bitmapFontUninstall).not.toHaveBeenCalled();

    // The last owner releasing it finally tears the atlas (and the install's
    // face) down.
    uninstallBitmapFont("Inter");
    expect(mocks.bitmapFontUninstall).toHaveBeenCalledWith("Inter");
    expect(mocks.assetsUnload).toHaveBeenCalledWith("fonts/Inter.ttf");
  });

  it("two web fonts sharing a family hold the atlas until both unload", async () => {
    await loadWebFont("a.woff2", { family: "Shared", bitmap: true });
    await loadWebFont("b.woff2", { family: "Shared", bitmap: true });

    unloadWebFont("a.woff2");
    expect(mocks.bitmapFontUninstall).not.toHaveBeenCalled();

    unloadWebFont("b.woff2");
    expect(mocks.bitmapFontUninstall).toHaveBeenCalledWith("Shared");
  });
});
