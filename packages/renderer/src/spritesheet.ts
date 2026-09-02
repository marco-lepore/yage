import { Texture, Rectangle, Assets } from "pixi.js";
import type { Spritesheet } from "pixi.js";
import type { TextureSliceOptions } from "./public-types.js";
import { resolveTextureInput } from "./assets.js";

/** Grid options with defaults applied against a concrete texture. */
interface GridLayout {
  frameWidth: number;
  frameHeight: number;
  startX: number;
  startY: number;
  gapX: number;
  gapY: number;
  columns: number;
  count: number;
}

function resolveGridLayout(
  base: Texture,
  options: TextureSliceOptions,
): GridLayout {
  const frameWidth = options.frameWidth;
  const frameHeight = options.frameHeight ?? frameWidth;
  const startX = options.startX ?? 0;
  const startY = options.startY ?? 0;
  const gapX = options.gapX ?? 0;
  const gapY = options.gapY ?? 0;
  const columns =
    options.columns ??
    Math.max(1, Math.floor((base.width - startX + gapX) / (frameWidth + gapX)));
  const count = options.count ?? columns;
  return {
    frameWidth,
    frameHeight,
    startX,
    startY,
    gapX,
    gapY,
    columns,
    count,
  };
}

/**
 * Slice a texture into frame Textures on a uniform grid.
 *
 * Frame `i` is read at column `i % columns`, row `floor(i / columns)`.
 * Without `columns`, the column count is derived from the texture width;
 * without `count`, a single full row is read.
 */
export function sliceGrid(
  base: Texture,
  options: TextureSliceOptions,
): Texture[] {
  const {
    frameWidth,
    frameHeight,
    startX,
    startY,
    gapX,
    gapY,
    columns,
    count,
  } = resolveGridLayout(base, options);
  const frames: Texture[] = [];

  for (let index = 0; index < count; index++) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    frames.push(
      new Texture({
        source: base.source,
        frame: new Rectangle(
          startX + column * (frameWidth + gapX),
          startY + row * (frameHeight + gapY),
          frameWidth,
          frameHeight,
        ),
      }),
    );
  }

  return frames;
}

/**
 * Slice a single-row horizontal spritesheet into individual frame Textures.
 *
 * Only reads the top row of the image (`y = 0`). For multi-row grid sheets,
 * use a {@link SheetFrameSource} with `count`/`columns` (or call
 * {@link sliceGrid} directly); for non-uniform frame layouts, use PixiJS's
 * `Spritesheet` class with a JSON atlas descriptor (TexturePacker / Aseprite
 * JSON export format).
 *
 * @param source - A PixiJS Texture or asset path string.
 * @param frameWidth - Width of each frame in pixels.
 * @param frameHeight - Height of each frame (defaults to `frameWidth` for square frames).
 */
export function sliceSheet(
  source: Texture | string,
  frameWidth: number,
  frameHeight?: number,
): Texture[] {
  // String keys resolve through the shared guard, so an unloaded /
  // unregistered sheet fails loudly naming the key instead of slicing an
  // empty texture.
  const base = source instanceof Texture ? source : resolveTextureInput(source);
  base.source.scaleMode = "nearest";
  const count = Math.floor(base.width / frameWidth);
  if (count === 0) {
    throw new Error(
      `sliceSheet: frameWidth (${frameWidth}) exceeds texture width (${base.width})`,
    );
  }
  return sliceGrid(base, {
    frameWidth,
    ...(frameHeight !== undefined ? { frameHeight } : {}),
    columns: count,
    count,
  });
}

// ---------------------------------------------------------------------------
// FrameSource — asset-backed frame descriptors
// ---------------------------------------------------------------------------

/**
 * A sprite sheet sliced on a uniform grid. Without `count`/`columns` it
 * reads the single top row (a horizontal strip); `count` extends the slice
 * across rows, wrapping every `columns` frames. Offsets and gaps follow
 * {@link TextureSliceOptions}.
 */
export interface SheetFrameSource extends TextureSliceOptions {
  sheet: string;
}

/** A named animation within a JSON atlas spritesheet. */
export interface AtlasFrameSource {
  atlas: string;
  animation: string;
}

/** Union type for asset-backed frame references. */
export type FrameSource = SheetFrameSource | AtlasFrameSource;

export function isSheetSource(s: FrameSource): s is SheetFrameSource {
  return "sheet" in s;
}

export function isAtlasSource(s: FrameSource): s is AtlasFrameSource {
  return "atlas" in s;
}

/**
 * Resolve a FrameSource to concrete Texture[].
 * Assets must already be loaded (via scene preload) — this is synchronous.
 */
export function resolveFrames(source: FrameSource): Texture[] {
  if (isSheetSource(source)) {
    const { sheet, ...options } = source;
    // Resolve through the shared guard so an unloaded / unregistered sheet
    // fails loudly naming the key instead of reading an undefined texture.
    const base = resolveTextureInput(sheet);
    base.source.scaleMode = "nearest";
    const layout = resolveGridLayout(base, options);
    for (const [name, value, min] of [
      ["frameWidth", layout.frameWidth, 1],
      ["frameHeight", layout.frameHeight, 1],
      ["startX", layout.startX, 0],
      ["startY", layout.startY, 0],
      ["gapX", layout.gapX, 0],
      ["gapY", layout.gapY, 0],
      ["columns", layout.columns, 1],
      ["count", layout.count, 1],
    ] as const) {
      if (!Number.isFinite(value) || value < min) {
        throw new Error(
          `resolveFrames: invalid ${name} (${value}) for sheet "${sheet}" — ` +
            `expected a finite number >= ${min}.`,
        );
      }
    }
    const usedColumns = Math.min(layout.count, layout.columns);
    const rows = Math.ceil(layout.count / layout.columns);
    const maxX =
      layout.startX +
      usedColumns * layout.frameWidth +
      (usedColumns - 1) * layout.gapX;
    const maxY =
      layout.startY + rows * layout.frameHeight + (rows - 1) * layout.gapY;
    if (maxX > base.width || maxY > base.height) {
      throw new Error(
        `resolveFrames: the frame grid for sheet "${sheet}" extends to ` +
          `${maxX}×${maxY}, exceeding the ${base.width}×${base.height} texture ` +
          `(frameWidth ${layout.frameWidth}, frameHeight ${layout.frameHeight}, ` +
          `columns ${layout.columns}, count ${layout.count}).`,
      );
    }
    return sliceGrid(base, options);
  }
  const spritesheet = Assets.get<Spritesheet>(source.atlas);
  if (!spritesheet) {
    throw new Error(
      `resolveFrames: atlas "${source.atlas}" is not loaded. Add it to scene preload.`,
    );
  }
  const textures = spritesheet.animations[source.animation];
  if (!textures) {
    throw new Error(
      `resolveFrames: animation "${source.animation}" not found in atlas "${source.atlas}".`,
    );
  }
  return textures;
}
