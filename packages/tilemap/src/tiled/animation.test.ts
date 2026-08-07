import { describe, expect, it } from "vitest";
import { readTileAnimation } from "./animation.js";
import { loadFixture } from "./fixtures/loadFixture.js";
import { resolveTilesetData } from "./resolveTilesetData.js";
import type { TilesetData } from "./types.js";

function fixtureTileset(name: string): TilesetData {
  const ref = loadFixture(name).tilesets[0];
  if (!ref) throw new Error(`Fixture "${name}" has no tileset.`);
  const tileset = resolveTilesetData(ref);
  if (!tileset) throw new Error(`Fixture "${name}" has no tileset data.`);
  return tileset;
}

function tilesetWithFrames(
  tileids: number[],
  overrides: Partial<TilesetData> = {},
): TilesetData {
  return {
    name: "test",
    tilewidth: 16,
    tileheight: 16,
    tilecount: 4,
    columns: 4,
    image: "test.png",
    tiles: [
      {
        id: 0,
        animation: tileids.map((tileid) => ({ tileid, duration: 100 })),
      },
    ],
    ...overrides,
  };
}

describe("readTileAnimation", () => {
  it("reads an equal-duration constant horizontal stride", () => {
    expect(
      readTileAnimation(fixtureTileset("animation-horizontal.json"), 0),
    ).toEqual({
      supported: true,
      animation: {
        firstFrameId: 0,
        strideX: 18,
        strideY: 0,
        frameCount: 3,
        frameDurationMs: 100,
      },
    });
  });

  it("returns null for no animation or one frame", () => {
    expect(readTileAnimation(fixtureTileset("embedded.json"), 0)).toBeNull();
    expect(
      readTileAnimation(fixtureTileset("animation-single-frame.json"), 0),
    ).toBeNull();
  });

  it("rejects unequal frame durations and names them", () => {
    const result = readTileAnimation(
      fixtureTileset("animation-unequal-durations.json"),
      0,
    );
    expect(result).toEqual({
      supported: false,
      reason: "Frame durations differ (100, 200 ms).",
    });
  });

  it("rejects non-positive frame durations", () => {
    const tileset = tilesetWithFrames([0, 1]);
    const frame = tileset.tiles?.[0]?.animation?.[1];
    if (frame) frame.duration = 0;
    expect(readTileAnimation(tileset, 0)).toEqual({
      supported: false,
      reason: "Frame durations must be positive numbers (100, 0 ms).",
    });
  });

  it("rejects a stride that changes between frames", () => {
    const result = readTileAnimation(
      fixtureTileset("animation-uneven-stride.json"),
      0,
    );
    expect(result).toEqual({
      supported: false,
      reason: "Frame stride varies: expected (16, 0), found (32, 0).",
    });
  });

  it("rejects collection-of-images animations", () => {
    expect(
      readTileAnimation(fixtureTileset("animation-collection.json"), 0),
    ).toEqual({
      supported: false,
      reason: "Each tile is stored in a separate image.",
    });
  });

  it("rejects frame ids outside the tileset", () => {
    expect(readTileAnimation(tilesetWithFrames([0, 4]), 0)).toEqual({
      supported: false,
      reason: "Frame tile id 4 is outside this tileset.",
    });
  });

  it("rejects negative and overflowing strides", () => {
    expect(readTileAnimation(tilesetWithFrames([1, 0]), 0)).toEqual({
      supported: false,
      reason: "Frame stride cannot be negative (-16, 0).",
    });
    expect(
      readTileAnimation(
        tilesetWithFrames([0, 1], {
          tilewidth: 2048,
          imagewidth: 8192,
        }),
        0,
      ),
    ).toEqual({
      supported: false,
      reason: "Frame stride must stay below 2048 pixels (2048, 0).",
    });
  });
});
