import { Texture, Rectangle, Assets } from "pixi.js";
import type { Spritesheet } from "pixi.js";

/**
 * Slice a single-row horizontal spritesheet into individual frame Textures.
 *
 * Only reads the top row of the image (`y = 0`). For multi-row sheets or
 * non-uniform frame layouts, use PixiJS's `Spritesheet` class with a JSON
 * atlas descriptor (TexturePacker / Aseprite JSON export format) instead.
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
  const h = frameHeight ?? frameWidth;
  const count = Math.floor(base.width / frameWidth);
  if (count === 0) {
    throw new Error(
      `sliceSheet: frameWidth (${frameWidth}) exceeds texture width (${base.width})`,
    );
  }
  const frames: Texture[] = [];
  for (let i = 0; i < count; i++) {
    frames.push(
      new Texture({
        source: base.source,
        frame: new Rectangle(i * frameWidth, 0, frameWidth, h),
      }),
    );
  }
  return frames;
}

// ---------------------------------------------------------------------------
// FrameSource — serializable frame descriptors
// ---------------------------------------------------------------------------

/** A horizontal sprite strip: resolve by slicing a single-row texture. */
export interface StripFrameSource {
  sheet: string;
  frameWidth: number;
  frameHeight?: number;
}

/** A named animation within a JSON atlas spritesheet. */
export interface AtlasFrameSource {
  atlas: string;
  animation: string;
}

/** Union type for serializable frame references. */
export type FrameSource = StripFrameSource | AtlasFrameSource;

export function isStripSource(s: FrameSource): s is StripFrameSource {
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
  if (isStripSource(source)) {
    return sliceSheet(source.sheet, source.frameWidth, source.frameHeight);
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
