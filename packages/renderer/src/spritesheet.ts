import { Texture, Rectangle } from "pixi.js";

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
