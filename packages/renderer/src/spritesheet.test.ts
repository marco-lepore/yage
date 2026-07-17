import { describe, it, expect, vi, beforeEach } from "vitest";

const { state } = vi.hoisted(() => ({
  state: { width: 96, height: 48, atlas: undefined as unknown },
}));

vi.mock("pixi.js", () => {
  class MockTexture {
    source = { scaleMode: "linear" };
    width: number;
    height: number;
    frame: { x: number; y: number; width: number; height: number } | undefined;
    constructor(opts?: {
      source?: unknown;
      frame?: { x: number; y: number; width: number; height: number };
    }) {
      this.frame = opts?.frame;
      this.width = opts?.frame?.width ?? state.width;
      this.height = opts?.frame?.height ?? state.height;
    }
    static from(): MockTexture {
      return new MockTexture();
    }
  }
  class MockRectangle {
    constructor(
      public x: number,
      public y: number,
      public width: number,
      public height: number,
    ) {}
  }
  return {
    Texture: MockTexture,
    Rectangle: MockRectangle,
    Assets: { get: () => state.atlas },
  };
});

import { Texture } from "pixi.js";
import { resolveFrames, sliceGrid, sliceSheet } from "./spritesheet.js";

function frameAt(frames: Texture[], i: number): { x: number; y: number } {
  const frame = (frames[i] as unknown as { frame: { x: number; y: number } })
    .frame;
  return { x: frame.x, y: frame.y };
}

beforeEach(() => {
  state.width = 96;
  state.height = 48;
  state.atlas = undefined;
});

describe("sliceGrid", () => {
  it("wraps rows every `columns` frames", () => {
    state.width = 882; // 7 columns of 126
    const frames = sliceGrid(Texture.from(""), {
      frameWidth: 126,
      frameHeight: 132,
      count: 48,
    });
    expect(frames).toHaveLength(48);
    expect(frameAt(frames, 0)).toEqual({ x: 0, y: 0 });
    expect(frameAt(frames, 6)).toEqual({ x: 756, y: 0 });
    expect(frameAt(frames, 7)).toEqual({ x: 0, y: 132 }); // second row
    expect(frameAt(frames, 47)).toEqual({ x: 630, y: 792 }); // row 6, col 5
  });

  it("honors an explicit `columns` override", () => {
    const frames = sliceGrid(Texture.from(""), {
      frameWidth: 48,
      columns: 2,
      count: 3,
    });
    expect(frameAt(frames, 1)).toEqual({ x: 48, y: 0 });
    expect(frameAt(frames, 2)).toEqual({ x: 0, y: 48 });
  });

  it("applies start offsets and gaps", () => {
    state.width = 200;
    const frames = sliceGrid(Texture.from(""), {
      frameWidth: 40,
      frameHeight: 30,
      startX: 2,
      startY: 4,
      gapX: 1,
      gapY: 2,
      columns: 2,
      count: 4,
    });
    expect(frameAt(frames, 0)).toEqual({ x: 2, y: 4 });
    expect(frameAt(frames, 1)).toEqual({ x: 43, y: 4 });
    expect(frameAt(frames, 2)).toEqual({ x: 2, y: 36 });
  });

  it("defaults to one full derived row", () => {
    const frames = sliceGrid(Texture.from(""), { frameWidth: 48 });
    expect(frames).toHaveLength(2); // 96 / 48
    expect(frameAt(frames, 1)).toEqual({ x: 48, y: 0 });
  });
});

describe("sliceSheet", () => {
  it("slices the top row and forces nearest scaling", () => {
    const base = Texture.from("");
    const frames = sliceSheet(base, 48);
    expect(frames).toHaveLength(2);
    expect(base.source.scaleMode).toBe("nearest");
  });

  it("throws when frameWidth exceeds the texture width", () => {
    expect(() => sliceSheet(Texture.from(""), 200)).toThrow(
      /exceeds texture width/,
    );
  });
});

describe("resolveFrames — sheet sources", () => {
  it("resolves a plain sheet as a single top row", () => {
    const frames = resolveFrames({ sheet: "player.png", frameWidth: 48 });
    expect(frames).toHaveLength(2);
    expect(frameAt(frames, 1)).toEqual({ x: 48, y: 0 });
  });

  it("resolves a grid sheet across rows via `count`", () => {
    state.width = 882;
    state.height = 924;
    const frames = resolveFrames({
      sheet: "boxer.png",
      frameWidth: 126,
      frameHeight: 132,
      count: 48,
    });
    expect(frames).toHaveLength(48);
    expect(frameAt(frames, 7)).toEqual({ x: 0, y: 132 });
  });

  it("throws when frameWidth exceeds the texture width", () => {
    expect(() =>
      resolveFrames({ sheet: "player.png", frameWidth: 200 }),
    ).toThrow(/exceeding/);
  });

  it("throws for an over-wide frameWidth even with explicit columns", () => {
    expect(() =>
      resolveFrames({ sheet: "narrow.png", frameWidth: 200, columns: 2 }),
    ).toThrow(/exceeding/);
  });

  it("throws when explicit columns push the grid past the texture edge", () => {
    // 96px wide: two 48px frames fit, a third column would start at x=96
    expect(() =>
      resolveFrames({ sheet: "player.png", frameWidth: 48, columns: 3, count: 3 }),
    ).toThrow(/exceeding/);
  });

  it("throws when count implies more rows than the texture height", () => {
    // 96×48: one 48px row exists, count 3 over 2 columns needs two rows
    expect(() =>
      resolveFrames({ sheet: "player.png", frameWidth: 48, columns: 2, count: 3 }),
    ).toThrow(/exceeding/);
  });

  it("accepts a grid whose final row is partially used", () => {
    state.width = 882; // 7 columns
    state.height = 924; // 7 rows
    const frames = resolveFrames({
      sheet: "boxer.png",
      frameWidth: 126,
      frameHeight: 132,
      count: 48, // uses 48 of the 49 cells
    });
    expect(frames).toHaveLength(48);
  });

  it("accepts offsets and gaps that stay inside the texture", () => {
    state.width = 100;
    state.height = 40;
    const frames = resolveFrames({
      sheet: "padded.png",
      frameWidth: 40,
      frameHeight: 30,
      startX: 2,
      startY: 4,
      gapX: 10,
      columns: 2,
      count: 2,
    });
    expect(frames).toHaveLength(2); // extents: 2+40+10+40 = 92 ≤ 100, 4+30 ≤ 40
  });
});

describe("resolveFrames — atlas sources", () => {
  it("returns the named animation's textures", () => {
    const walk = [Texture.from(""), Texture.from("")];
    state.atlas = { animations: { walk } };
    expect(resolveFrames({ atlas: "a.json", animation: "walk" })).toBe(walk);
  });

  it("throws when the atlas is not loaded", () => {
    expect(() =>
      resolveFrames({ atlas: "missing.json", animation: "walk" }),
    ).toThrow(/not loaded/);
  });
});
