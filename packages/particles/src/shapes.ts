import { BufferImageSource, Texture } from "pixi.js";
import type { TextureResource } from "@yagejs/renderer";

/**
 * A built-in particle shape. Emitters that specify no `texture` render one of
 * these, so a project needs no image asset to use particles.
 * Shapes are white — use `tint` to color them.
 */
export type ParticleShape =
  | "pixel"
  | "circle"
  | "softCircle"
  | "diamond"
  | "softDiamond"
  | "line";

/**
 * The generated texture's size in pixels: one value for a square, or an
 * explicit width and height. At the default `scale: 1` this is also the size a
 * particle covers on screen. Every distinct size generates and caches its own
 * texture, so keep to a few and vary per-particle size with `scale`.
 */
export type ShapeSize = number | [width: number, height: number];

/** A built-in shape with an explicit texture size. */
export interface ShapeConfig {
  type: ParticleShape;
  /**
   * Texture size in pixels, which is also the on-screen size at `scale: 1`.
   * Default: 64×64, or 64×8 for `"line"` and 1×1 for `"pixel"`. A non-square
   * size stretches the shape into it — `circle` at `[32, 16]` is an ellipse.
   */
  size?: ShapeSize;
}

/** A shape with its size resolved to concrete pixel dimensions. */
export interface ResolvedShape {
  type: ParticleShape;
  size: [width: number, height: number];
}

/** Texture size used when a shape config gives none. */
const DEFAULT_SIZE: Record<ParticleShape, [number, number]> = {
  pixel: [1, 1],
  circle: [64, 64],
  softCircle: [64, 64],
  diamond: [64, 64],
  softDiamond: [64, 64],
  line: [64, 8],
};

/**
 * Generated shapes keyed by `type:WxH`, built on first request and kept for the
 * process lifetime. The 1×1 `pixel` is absent — it maps to `Texture.WHITE`.
 */
const generated = new Map<string, TextureResource>();

/**
 * Fill in the default size and the string shorthand. `context` names the entry
 * point in the size error, so a caller that never invoked `shapeTexture` is not
 * told that it did.
 */
export function normalizeShape(
  shape: ParticleShape | ShapeConfig,
  context: string,
): ResolvedShape {
  const type = typeof shape === "string" ? shape : shape.type;
  const size = typeof shape === "string" ? undefined : shape.size;
  if (size === undefined) {
    const [width, height] = DEFAULT_SIZE[type];
    return { type, size: [width, height] };
  }
  // Texture dimensions are whole pixels.
  const width = typeof size === "number" ? size : size[0];
  const height = typeof size === "number" ? size : size[1];
  return {
    type,
    size: [toPixels(width, context), toPixels(height, context)],
  };
}

/**
 * Resolve a built-in shape to its texture. The returned texture is shared by
 * every emitter using that shape and size, so callers must never destroy it.
 */
export function shapeTexture(
  shape: ParticleShape | ShapeConfig,
): TextureResource {
  const {
    type,
    size: [width, height],
  } = normalizeShape(shape, "shapeTexture");

  // A 1×1 white square is exactly Texture.WHITE, so the zero-config path
  // generates nothing.
  if (type === "pixel" && width === 1 && height === 1) return Texture.WHITE;

  const key = `${type}:${width}x${height}`;
  const cached = generated.get(key);
  if (cached) return cached;

  const texture = createShapeTexture(type, width, height);
  generated.set(key, texture);
  return texture;
}

function createShapeTexture(
  type: ParticleShape,
  width: number,
  height: number,
): TextureResource {
  const pixels = new Uint8Array(width * height * 4);
  const rx = width / 2;
  const ry = height / 2;
  const inset = edgeInset(rx, ry);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Pixel centre relative to the texture centre.
      const cx = x + 0.5 - rx;
      const cy = y + 0.5 - ry;
      const a = Math.round(coverage(type, cx, cy, rx, ry, inset) * 255);
      const i = (y * width + x) * 4;
      // White with premultiplied alpha, so every channel equals the alpha.
      // The buffer upload path does no premultiplication of its own, so the
      // pixels are written premultiplied and declared as such — otherwise
      // soft edges fringe against dark backgrounds.
      pixels[i] = a;
      pixels[i + 1] = a;
      pixels[i + 2] = a;
      pixels[i + 3] = a;
    }
  }

  const label = `yage:particle-shape:${type}:${width}x${height}`;
  return new Texture({
    source: new BufferImageSource({
      resource: pixels,
      width,
      height,
      alphaMode: "premultiplied-alpha",
      label,
    }),
    label,
  });
}

/**
 * Alpha coverage (0–1) of a shape at one pixel centre, with `cx`/`cy` measured
 * from the texture centre and `rx`/`ry` the half-extents. Shapes are defined in
 * normalized coordinates with their edge at 1, so a non-square texture holds a
 * stretched shape (an ellipse) rather than a small circle with empty margins.
 */
function coverage(
  type: ParticleShape,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  inset: number,
): number {
  const nx = cx / rx;
  const ny = cy / ry;

  switch (type) {
    // Both fill their texture edge to edge: the shape has no boundary inside
    // the bitmap to antialias.
    case "pixel":
    case "line":
      return 1;
    case "circle":
    case "softCircle": {
      const d = Math.hypot(nx, ny);
      // A sample on the exact centre is inside every shape, whatever its size.
      // It is also where the circle's gradient is undefined.
      if (d === 0) return 1;
      const gradient = Math.hypot(nx / rx, ny / ry) / d;
      return type === "circle"
        ? hardEdge(d, gradient, inset)
        : softEdge(d, gradient);
    }
    case "diamond":
    case "softDiamond": {
      const d = Math.abs(nx) + Math.abs(ny);
      if (d === 0) return 1;
      const gradient = Math.hypot(1 / rx, 1 / ry);
      return type === "diamond"
        ? hardEdge(d, gradient, inset)
        : softEdge(d, gradient);
    }
  }
}

/**
 * How far inside the texture bounds a hard edge sits, in pixels, so the
 * outermost row antialiases instead of clipping. Only a shape with room to
 * spare can afford the full pixel: below 5px across the inset shrinks with the
 * shape, and below 3px it goes negative so the shape spills past the bounds
 * and fills its bitmap. A fixed inset erases anything 2px or thinner — the
 * whole shape falls inside it.
 */
function edgeInset(rx: number, ry: number): number {
  const half = Math.min(rx, ry);
  return Math.min(Math.max(half - 1.5, -0.5), 1);
}

/**
 * Alpha for a hard edge, from the normalized distance `d` (edge at 1) and how
 * fast `d` grows per pixel at that point. Dividing converts the normalized
 * margin back into pixels — per axis, so the ramp stays one pixel wide however
 * lopsided the texture is. The half pixel puts the ramp's midpoint on the edge
 * itself; `inset` then pulls the edge that many pixels inward.
 */
function hardEdge(d: number, gradientPerPixel: number, inset: number): number {
  return clamp01((1 - d) / gradientPerPixel + 0.5 - inset);
}

/**
 * Alpha for a soft shape, whose ramp is the shape. The falloff peaks at the
 * exact centre, which no sample lands on when a dimension is even, so the
 * distance drops by the half pixel each sample stands for — otherwise a 2px
 * puff renders as a faint ring instead of a bright dot.
 */
function softEdge(d: number, gradientPerPixel: number): number {
  return falloff(Math.max(0, d - gradientPerPixel / 2));
}

/** Smooth opaque-centre to transparent-edge ramp over `t` in 0–1. */
function falloff(t: number): number {
  if (t >= 1) return 0;
  const e = 1 - t;
  return e * e * (3 - 2 * e);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function toPixels(v: number, context: string): number {
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`${context}: shape size must be finite and > 0, got ${v}.`);
  }
  return Math.max(1, Math.round(v));
}
