// No pixi mock here on purpose: the shape generator must work against the real
// Pixi classes in a headless run, since it builds pixel buffers without a DOM.
import { describe, it, expect } from "vitest";
import { Texture } from "pixi.js";
import { shapeTexture } from "./shapes.js";
import type { ParticleShape, ShapeConfig, ShapeSize } from "./shapes.js";
import { ParticleEmitterComponent } from "./ParticleEmitterComponent.js";

/** Shapes whose outline sits inside the texture, leaving the corners empty. */
const OUTLINED: ParticleShape[] = [
  "circle",
  "softCircle",
  "diamond",
  "softDiamond",
];

/** Every shape that generates a texture at its default size. */
const GENERATED: ParticleShape[] = [...OUTLINED, "line"];

/** Every shape there is. */
const ALL: ParticleShape[] = [...GENERATED, "pixel"];

/** Read back the RGBA buffer a generated shape was built from. */
function pixels(shape: ParticleShape | ShapeConfig): Uint8Array {
  return shapeTexture(shape).source.resource as Uint8Array;
}

/** Alpha of one pixel of a `width`-wide shape. */
function alphaAt(
  shape: ParticleShape | ShapeConfig,
  width: number,
  x: number,
  y: number,
): number {
  return pixels(shape)[(y * width + x) * 4 + 3]!;
}

/** The highest alpha anywhere in a shape. */
function maxAlpha(shape: ParticleShape | ShapeConfig): number {
  // The 1x1 pixel is the shared white texture, which has no buffer to read.
  if (shapeTexture(shape) === Texture.WHITE) return 255;
  const data = pixels(shape);
  let max = 0;
  for (let i = 3; i < data.length; i += 4) max = Math.max(max, data[i]!);
  return max;
}

/** Alphas from the centre out to the right edge, along row `y`. */
function scanRight(shape: ShapeConfig, width: number, y: number): number[] {
  const out: number[] = [];
  for (let x = width / 2; x < width; x++) out.push(alphaAt(shape, width, x, y));
  return out;
}

/** Alphas from the centre down to the bottom edge, along column `x`. */
function scanDown(shape: ShapeConfig, width: number, x: number): number[] {
  const out: number[] = [];
  const height = shapeTexture(shape).height;
  for (let y = height / 2; y < height; y++)
    out.push(alphaAt(shape, width, x, y));
  return out;
}

/** Pixels an outward scan takes to go from fully opaque to fully clear. */
function edgeSteps(scan: number[]): number {
  const lastOpaque = scan.findLastIndex((a) => a >= 250);
  const firstClear = scan.findIndex((a) => a <= 5);
  expect(lastOpaque).toBeGreaterThanOrEqual(0);
  expect(firstClear).toBeGreaterThan(lastOpaque);
  return firstClear - lastOpaque;
}

describe("shapeTexture", () => {
  it("maps pixel to the shared white texture", () => {
    expect(shapeTexture("pixel")).toBe(Texture.WHITE);
    expect(shapeTexture({ type: "pixel" })).toBe(Texture.WHITE);
    expect(shapeTexture({ type: "pixel", size: 1 })).toBe(Texture.WHITE);
  });

  it("generates a solid rectangle for a sized pixel", () => {
    const texture = shapeTexture({ type: "pixel", size: [4, 2] });
    expect(texture.width).toBe(4);
    expect(texture.height).toBe(2);
    const data = pixels({ type: "pixel", size: [4, 2] });
    expect([...data]).toEqual(Array(4 * 2 * 4).fill(255));
  });

  it("fills a line's texture edge to edge, however thin", () => {
    // A 2px-wide raindrop has no room for an inset border: insetting one would
    // leave the whole streak transparent.
    const shape: ShapeConfig = { type: "line", size: [2, 20] };
    expect([...pixels(shape)]).toEqual(Array(2 * 20 * 4).fill(255));
    expect([...pixels("line")]).toEqual(Array(64 * 8 * 4).fill(255));
  });

  it.each(OUTLINED)(
    "generates %s with opaque and transparent pixels",
    (shape) => {
      const texture = shapeTexture(shape);
      expect(texture.width).toBeGreaterThan(0);
      expect(texture.height).toBeGreaterThan(0);

      const data = pixels(shape);
      expect(data.length).toBe(texture.width * texture.height * 4);
      // Every shape covers part of its texture and leaves part empty, so the
      // alpha channel has to span (near enough) the full range.
      const alphas = data.filter((_, i) => i % 4 === 3);
      expect(Math.max(...alphas)).toBeGreaterThan(250);
      expect(Math.min(...alphas)).toBe(0);
    },
  );

  it.each(GENERATED)(
    "keeps %s premultiplied — colour never exceeds alpha",
    (shape) => {
      const data = pixels(shape);
      for (let i = 0; i < data.length; i += 4) {
        expect(data[i]).toBe(data[i + 3]);
        expect(data[i + 1]).toBe(data[i + 3]);
        expect(data[i + 2]).toBe(data[i + 3]);
      }
      expect(shapeTexture(shape).source.alphaMode).toBe("premultiplied-alpha");
    },
  );

  it("gives softCircle a falloff and circle a flat centre-to-edge fill", () => {
    // 64x64: pixel (32, 32) is the centre, (32, 40) is 8px out along y.
    expect(alphaAt("softCircle", 64, 32, 32)).toBe(255);
    expect(alphaAt("softCircle", 64, 32, 40)).toBeLessThan(255);
    expect(alphaAt("circle", 64, 32, 40)).toBe(255);
  });

  describe("size", () => {
    it("reads a scalar as a square and a tuple as width by height", () => {
      const square = shapeTexture({ type: "circle", size: 16 });
      expect([square.width, square.height]).toEqual([16, 16]);
      expect(shapeTexture({ type: "circle", size: [32, 16] }).width).toBe(32);
      expect(shapeTexture({ type: "circle", size: [32, 16] }).height).toBe(16);
    });

    it("defaults to 64x64, and to 64x8 for line", () => {
      expect([
        shapeTexture("circle").width,
        shapeTexture("circle").height,
      ]).toEqual([64, 64]);
      expect([shapeTexture("line").width, shapeTexture("line").height]).toEqual(
        [64, 8],
      );
    });

    it("caches by type and size together", () => {
      const scalar = shapeTexture({ type: "circle", size: 16 });
      expect(shapeTexture({ type: "circle", size: [16, 16] })).toBe(scalar);
      expect(shapeTexture({ type: "circle", size: 16 })).toBe(scalar);
      expect(shapeTexture({ type: "circle", size: 32 })).not.toBe(scalar);
      expect(shapeTexture({ type: "diamond", size: 16 })).not.toBe(scalar);
      expect(shapeTexture("circle")).not.toBe(scalar);
    });

    it("stretches a circle into a non-square size instead of leaving margins", () => {
      const shape: ShapeConfig = { type: "circle", size: [64, 16] };
      // Middle row and middle column, one pixel in from each border: an
      // ellipse fills the whole texture, an inscribed circle would not.
      expect(alphaAt(shape, 64, 1, 8)).toBeGreaterThan(0);
      expect(alphaAt(shape, 64, 62, 8)).toBeGreaterThan(0);
      expect(alphaAt(shape, 64, 32, 1)).toBeGreaterThan(0);
      expect(alphaAt(shape, 64, 32, 14)).toBeGreaterThan(0);
      // Corners stay outside it.
      expect(alphaAt(shape, 64, 0, 0)).toBe(0);
      expect(alphaAt(shape, 64, 63, 15)).toBe(0);
    });

    it("antialiases a circle over one pixel on both axes of a lopsided size", () => {
      const shape: ShapeConfig = { type: "circle", size: [64, 16] };
      // Scanning outward from the centre meets the edge head-on at each axis
      // extreme, so the steps from opaque to clear are the width of the
      // antialiasing band. Converting the normalized margin to pixels with one
      // factor for both axes would stretch the band along the long axis by the
      // aspect ratio — 4x here.
      expect(edgeSteps(scanRight(shape, 64, 8))).toBeLessThanOrEqual(2);
      expect(edgeSteps(scanDown(shape, 64, 32))).toBeLessThanOrEqual(2);
    });

    it.each([
      1,
      2,
      3,
      4,
      5,
      8,
      [64, 2],
      [2, 64],
      [64, 1],
      [1, 64],
      [64, 3],
      [3, 64],
    ] as ShapeSize[])("keeps every shape visible at size %j", (size) => {
      // A fixed antialiasing inset erases a shape 2px or thinner outright: the
      // whole thing falls inside the inset. Whatever the size, a shape has to
      // put something solid on screen.
      for (const type of ALL) {
        expect(maxAlpha({ type, size })).toBeGreaterThanOrEqual(128);
      }
    });

    it("draws every shape as one opaque pixel at 1x1", () => {
      // Nothing distinguishes a circle from a diamond in a single pixel, so
      // they must not disagree about whether that pixel is there.
      for (const type of ALL) {
        expect(maxAlpha({ type, size: 1 })).toBe(255);
      }
    });

    it("keeps a stretched circle solid along its long axis", () => {
      // The centre row of a 64x2 ellipse: thin enough that an inset would take
      // all of it, wide enough that the taper is only at the ends.
      const shape: ShapeConfig = { type: "circle", size: [64, 2] };
      expect(alphaAt(shape, 64, 32, 0)).toBe(255);
      expect(alphaAt(shape, 64, 8, 1)).toBe(255);
    });

    it("rejects a size that is not a positive finite number", () => {
      for (const size of [0, -8, NaN, Infinity] as ShapeSize[]) {
        expect(() => shapeTexture({ type: "circle", size })).toThrow(
          /^shapeTexture: shape size must be finite and > 0/,
        );
      }
      expect(() =>
        shapeTexture({ type: "circle", size: [16, Infinity] }),
      ).toThrow(/size must be finite and > 0/);
    });

    it("antialiases a diamond over one pixel across its lopsided short axis", () => {
      // Only the short axis is measurable this way: the diamond's long edges
      // run shallow, so a horizontal scan crosses a one-pixel band at a glancing
      // angle and legitimately spans several pixels.
      const shape: ShapeConfig = { type: "diamond", size: [64, 16] };
      expect(edgeSteps(scanDown(shape, 64, 32))).toBeLessThanOrEqual(2);
    });
  });

  it("returns the same instance for repeated requests", () => {
    expect(shapeTexture("circle")).toBe(shapeTexture("circle"));
    expect(shapeTexture("circle")).not.toBe(shapeTexture("diamond"));
  });

  it("shares one texture across emitters and survives their teardown", () => {
    const first = new ParticleEmitterComponent({
      shape: "circle",
      lifetime: 1,
    });
    const second = new ParticleEmitterComponent({
      shape: "circle",
      lifetime: 1,
    });
    const shared = shapeTexture("circle");
    expect(first.container.texture).toBe(shared);
    expect(second.container.texture).toBe(shared);

    first.onDestroy?.();

    expect(shared.destroyed).toBe(false);
    expect(shapeTexture("circle")).toBe(shared);
    expect(second.container.texture).toBe(shared);
  });

  it("leaves Texture.WHITE intact when a default emitter is torn down", () => {
    const emitter = new ParticleEmitterComponent({ lifetime: 1 });
    emitter.onDestroy?.();
    expect(Texture.WHITE.destroyed).toBe(false);
  });
});
