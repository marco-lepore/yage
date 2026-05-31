import { beforeEach, describe, expect, it } from "vitest";
import { buildTextOptions } from "./textConstruction.js";
import {
  clearBitmapFontVariants,
  registerBitmapFontVariant,
} from "./bitmapFontVariants.js";

describe("buildTextOptions bitmap variant selection", () => {
  beforeEach(() => {
    clearBitmapFontVariants();
  });

  it("redirects fontFamily to the bold variant atlas for bold bitmap text", () => {
    registerBitmapFontVariant("Body", {}, "Body");
    registerBitmapFontVariant("Body", { fontWeight: "bold" }, "Body bold");

    const { options } = buildTextOptions(
      "Hi",
      { fontFamily: "Body", fontWeight: "bold" },
      true,
      undefined,
    );

    // The variant atlas baked its own weight; the family is swapped and the
    // emphasis prop dropped so Pixi resolves the bold atlas by family key
    // instead of triggering a second dynamic bake.
    expect(options.style).toMatchObject({ fontFamily: "Body bold" });
    expect(options.style).not.toHaveProperty("fontWeight");
  });

  it("redirects to the italic variant for italic bitmap text", () => {
    registerBitmapFontVariant("Body", {}, "Body");
    registerBitmapFontVariant("Body", { fontStyle: "italic" }, "Body italic");

    const { options } = buildTextOptions(
      "Hi",
      { fontFamily: "Body", fontStyle: "italic" },
      true,
      undefined,
    );

    expect(options.style).toMatchObject({ fontFamily: "Body italic" });
    expect(options.style).not.toHaveProperty("fontStyle");
  });

  it("leaves the style untouched when the family hosts no variants", () => {
    const { options } = buildTextOptions(
      "Hi",
      { fontFamily: "Plain", fontWeight: "bold" },
      true,
      undefined,
    );

    expect(options.style).toMatchObject({
      fontFamily: "Plain",
      fontWeight: "bold",
    });
  });

  it("keeps the base atlas for regular text on a font that has variants", () => {
    registerBitmapFontVariant("Body", {}, "Body");
    registerBitmapFontVariant("Body", { fontWeight: "bold" }, "Body bold");

    const { options } = buildTextOptions(
      "Hi",
      { fontFamily: "Body" },
      true,
      undefined,
    );

    expect(options.style).toMatchObject({ fontFamily: "Body" });
  });

  it("does not redirect for canvas (non-bitmap) text", () => {
    registerBitmapFontVariant("Body", {}, "Body");
    registerBitmapFontVariant("Body", { fontWeight: "bold" }, "Body bold");

    const { options } = buildTextOptions(
      "Hi",
      { fontFamily: "Body", fontWeight: "bold" },
      false,
      undefined,
    );

    // Canvas `Text` honours fontWeight natively — leave it alone.
    expect(options.style).toMatchObject({
      fontFamily: "Body",
      fontWeight: "bold",
    });
  });
});
