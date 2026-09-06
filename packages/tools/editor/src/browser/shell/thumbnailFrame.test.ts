import { describe, expect, it } from "vitest";
import {
  atlasFrame,
  atlasPathFor,
  declaredFrame,
  framePlacement,
} from "./thumbnailFrame.js";

describe("atlasPathFor", () => {
  it("names the atlas beside the texture", () => {
    expect(atlasPathFor("assets/player_idle.png")).toBe(
      "assets/player_idle.json",
    );
  });

  it("keeps the rest of the path, including other dots", () => {
    expect(atlasPathFor("assets/v1.2/hero.png")).toBe("assets/v1.2/hero.json");
  });

  it("has nothing to name for a path with no extension", () => {
    expect(atlasPathFor("assets/hero")).toBeUndefined();
    expect(atlasPathFor(".hidden")).toBeUndefined();
  });
});

describe("atlasFrame", () => {
  const atlas = {
    frames: {
      "idle-0": { frame: { x: 0, y: 0, w: 48, h: 48 } },
      "idle-1": { frame: { x: 48, y: 0, w: 48, h: 48 } },
    },
    meta: { size: { w: 480, h: 48 } },
  };

  it("takes the first frame the atlas names", () => {
    expect(atlasFrame(atlas)).toEqual({
      x: 0,
      y: 0,
      width: 48,
      height: 48,
      sheetWidth: 480,
      sheetHeight: 48,
    });
  });

  it("skips a frame with no rectangle and takes the next", () => {
    const holey = {
      frames: {
        broken: {},
        "idle-1": { frame: { x: 48, y: 0, w: 48, h: 48 } },
      },
      meta: { size: { w: 480, h: 48 } },
    };

    expect(atlasFrame(holey)?.x).toBe(48);
  });

  it("answers nothing for JSON that is not an atlas", () => {
    expect(atlasFrame({ hello: "world" })).toBeUndefined();
    expect(atlasFrame(null)).toBeUndefined();
    expect(atlasFrame("not json")).toBeUndefined();
    // No sheet size means no way to place the frame.
    expect(atlasFrame({ frames: atlas.frames })).toBeUndefined();
    // The array form shows the whole image rather than being half read.
    expect(
      atlasFrame({
        frames: [{ frame: { x: 0, y: 0, w: 1, h: 1 } }],
        meta: atlas.meta,
      }),
    ).toBeUndefined();
  });
});

describe("framePlacement", () => {
  it("scales the sheet so one frame fills the box", () => {
    const placement = framePlacement(
      { x: 0, y: 0, width: 48, height: 48, sheetWidth: 480, sheetHeight: 48 },
      24,
    );

    // Half size, so the ten-frame strip is 240 wide and its first frame fills
    // the box from its top-left corner.
    expect(placement).toEqual({ width: 240, height: 24, left: 0, top: 0 });
  });

  it("pushes a later frame into the box", () => {
    const placement = framePlacement(
      { x: 48, y: 0, width: 48, height: 48, sheetWidth: 480, sheetHeight: 48 },
      24,
    );

    expect(placement.left).toBe(-24);
  });

  it("centres a frame that is not square instead of stretching it", () => {
    const placement = framePlacement(
      { x: 0, y: 0, width: 16, height: 32, sheetWidth: 16, sheetHeight: 32 },
      24,
    );

    expect(placement.height).toBe(24);
    expect(placement.width).toBe(12);
    expect(placement.left).toBe(6);
    expect(placement.top).toBe(0);
  });
});

describe("declaredFrame", () => {
  it("squares the frame when the declaration gives no height", () => {
    expect(declaredFrame({ frameWidth: 48 }, 480, 48)).toEqual({
      x: 0,
      y: 0,
      width: 48,
      height: 48,
      sheetWidth: 480,
      sheetHeight: 48,
    });
  });

  it("honours an offset and an explicit height", () => {
    expect(
      declaredFrame(
        { frameWidth: 32, frameHeight: 16, startX: 8, startY: 4 },
        480,
        48,
      ),
    ).toEqual({
      x: 8,
      y: 4,
      width: 32,
      height: 16,
      sheetWidth: 480,
      sheetHeight: 48,
    });
  });

  it("places the first frame of a strip in the box", () => {
    const frame = declaredFrame({ frameWidth: 48 }, 480, 48);
    if (frame === undefined) throw new Error("expected a frame");
    expect(framePlacement(frame, 24)).toEqual({
      width: 240,
      height: 24,
      left: 0,
      top: 0,
    });
  });

  it("refuses a grid that runs off the image, in either direction", () => {
    expect(declaredFrame({ frameWidth: 64 }, 480, 48)).toBeUndefined();
    expect(
      declaredFrame({ frameWidth: 48, startX: 460 }, 480, 48),
    ).toBeUndefined();
  });

  it("has nothing to answer before the image has loaded", () => {
    expect(declaredFrame({ frameWidth: 48 }, 0, 0)).toBeUndefined();
  });
});
