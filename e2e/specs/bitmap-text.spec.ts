import { expect, test } from "@playwright/test";
import { getComponentData, gotoFixture, stepFrames, waitForClock } from "./helpers.js";

interface ProbeData {
  pixiClass: string;
  glyphWidth: number;
  glyphHeight: number;
  worldScaleX: number;
  captured: boolean;
}

test.describe("Bitmap text fixture", () => {
  test("bitmap: true constructs a BitmapText and lays glyphs out at scale", async ({
    page,
  }) => {
    await gotoFixture(page, "/bitmap-text.html");
    await waitForClock(page);
    await stepFrames(page, 2);

    const probe = await getComponentData<ProbeData>(
      page,
      "bitmap-label",
      "BitmapTextProbe",
    );

    expect(probe?.captured).toBe(true);
    // The glyph atlas signature: the bitmap path was taken, not canvas Text.
    expect(probe?.pixiClass).toBe("BitmapText");
    // The atlas produced real glyph geometry for "YAGE".
    expect(probe?.glyphWidth).toBeGreaterThan(0);
    expect(probe?.glyphHeight).toBeGreaterThan(0);
    // …and it's drawn upscaled, where canvas text would have gone blurry.
    expect(probe?.worldScaleX).toBe(4);
  });
});
