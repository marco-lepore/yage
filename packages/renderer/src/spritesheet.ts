import { Texture, Rectangle, Assets } from "pixi.js";
import type { Spritesheet } from "pixi.js";
import type { TextureSliceOptions } from "./public-types.js";

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
  const base = source instanceof Texture ? source : Texture.from(source);
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
// FrameSource — serializable frame descriptors
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

/** Union type for serializable frame references. */
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
    const base = Texture.from(sheet);
    base.source.scaleMode = "nearest";
    if (Math.floor(base.width / options.frameWidth) === 0) {
      throw new Error(
        `resolveFrames: frameWidth (${options.frameWidth}) exceeds texture width (${base.width}) for sheet "${sheet}".`,
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
