/**
 * Which part of a texture a thumbnail shows.
 *
 * A type's art is often a sprite sheet, and fitting a whole horizontal strip
 * into a 24-pixel square draws a line. Three answers, in this order: the frame
 * grid the asset parameter declares, then an atlas the project ships beside
 * the image, then the whole image fitted. Nothing is ever read from the
 * image's own proportions — they cannot tell a strip of frames from one wide
 * prop, and a platform cropped to its left quarter is worse than a strip drawn
 * small.
 */

import type { AssetFrames } from "@yagejs/level";

/** A rectangle of a sheet, and the sheet it is cut from. Pixels. */
export interface ThumbnailFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly sheetWidth: number;
  readonly sheetHeight: number;
}

/**
 * The first frame of a declared grid, or `undefined` when the grid does not
 * fit the loaded image.
 *
 * The first frame rather than a chosen one: a declaration belongs to the type,
 * so an authored index would fix one picture for every placement of it, and
 * the first frame of an animation is its rest pose.
 *
 * A grid that runs off the edge is refused rather than clamped. A declared
 * default can name a file the project later replaced, and a thumbnail drawn
 * from outside the image is worse than the whole image drawn small. The
 * numbers themselves need no checking here: `buildLevelCatalog` refuses a
 * declaration whose grid could not slice anything, so a catalog that built has
 * none.
 */
export function declaredFrame(
  frames: AssetFrames,
  sheetWidth: number,
  sheetHeight: number,
): ThumbnailFrame | undefined {
  if (sheetWidth <= 0 || sheetHeight <= 0) return undefined;
  const x = frames.startX ?? 0;
  const y = frames.startY ?? 0;
  const width = frames.frameWidth;
  // A sheet declared without a frame height is one row of square frames, which
  // is what the renderer's own slice does with the same members absent.
  const height = frames.frameHeight ?? frames.frameWidth;
  if (x + width > sheetWidth || y + height > sheetHeight) return undefined;
  return { x, y, width, height, sheetWidth, sheetHeight };
}

/**
 * The atlas that would describe `texturePath`, by the convention every atlas
 * packer follows: the same name with a `.json` extension.
 *
 * Answers a path to look for in the project's asset listing, never one to
 * fetch blindly — a request per placeable type that mostly answers 404 fills a
 * developer's console with failures that are not failures.
 */
export function atlasPathFor(texturePath: string): string | undefined {
  const dot = texturePath.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return texturePath.slice(0, dot) + ".json";
}

interface AtlasRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function isRect(value: unknown): value is AtlasRect {
  if (typeof value !== "object" || value === null) return false;
  const rect = value as Record<string, unknown>;
  return (
    typeof rect["x"] === "number" &&
    typeof rect["y"] === "number" &&
    typeof rect["w"] === "number" &&
    typeof rect["h"] === "number"
  );
}

/**
 * The first frame an atlas names, or `undefined` when the JSON is not one.
 *
 * The first rather than a chosen one: the atlas orders its frames the way the
 * packer wrote them, which for an animation is its first pose — the same thing
 * the sheet's leftmost frame would be.
 *
 * `frames` is read as an object, which is what Pixi's own loader requires; an
 * array-form atlas shows the whole image rather than being half supported.
 */
export function atlasFrame(json: unknown): ThumbnailFrame | undefined {
  if (typeof json !== "object" || json === null) return undefined;
  const root = json as Record<string, unknown>;

  const meta = root["meta"];
  if (typeof meta !== "object" || meta === null) return undefined;
  const size = (meta as Record<string, unknown>)["size"];
  if (typeof size !== "object" || size === null) return undefined;
  const sheet = size as Record<string, unknown>;
  const sheetWidth = sheet["w"];
  const sheetHeight = sheet["h"];
  if (typeof sheetWidth !== "number" || typeof sheetHeight !== "number") {
    return undefined;
  }

  const frames = root["frames"];
  if (typeof frames !== "object" || frames === null || Array.isArray(frames)) {
    return undefined;
  }
  for (const entry of Object.values(frames as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) continue;
    const rect = (entry as Record<string, unknown>)["frame"];
    if (!isRect(rect)) continue;
    if (rect.w <= 0 || rect.h <= 0) continue;
    return {
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      sheetWidth,
      sheetHeight,
    };
  }
  return undefined;
}

/** Where a framed image sits inside its box, in CSS pixels. */
export interface FramePlacement {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
}

/**
 * How to place the whole sheet so that one frame fills a square box.
 *
 * The image keeps its own proportions and is pushed so the frame lands in the
 * middle; the box clips the rest. A frame that is not square is centred on its
 * short axis rather than stretched, since a thumbnail that lies about a
 * sprite's shape is worse than one with a margin.
 */
export function framePlacement(
  frame: ThumbnailFrame,
  boxPixels: number,
): FramePlacement {
  const scale = boxPixels / Math.max(frame.width, frame.height);
  return {
    width: frame.sheetWidth * scale,
    height: frame.sheetHeight * scale,
    left: (boxPixels - frame.width * scale) / 2 - frame.x * scale,
    top: (boxPixels - frame.height * scale) / 2 - frame.y * scale,
  };
}
