import { AssetHandle } from "@yagejs/core";
import { Rectangle, Texture } from "pixi.js";
import type { Spritesheet } from "pixi.js";
import type {
  RendererAsset,
  TextureHandle,
  TextureInput,
  TextureResource,
  TextureSliceOptions,
} from "./public-types.js";

/** Create a typed asset handle for a texture. */
export function texture(path: string): TextureHandle {
  return new AssetHandle("texture", path);
}

/** Create a typed asset handle for a spritesheet JSON atlas. */
export function spritesheet(path: string): AssetHandle<Spritesheet> {
  return new AssetHandle("spritesheet", path);
}

/** Create a typed handle for an arbitrary renderer-managed asset. */
export function renderAsset<T = unknown>(path: string): RendererAsset<T> {
  return new AssetHandle("render-asset", path);
}

/** Resolve a texture input into a concrete texture resource. */
export function resolveTextureInput(input: TextureInput): TextureResource {
  if (input instanceof AssetHandle) {
    return Texture.from(input.path);
  }
  if (typeof input === "string") {
    return Texture.from(input);
  }
  return input;
}

/** Slice a texture input into an array of frame textures. */
export function sliceTextureFrames(
  input: TextureInput,
  options: TextureSliceOptions,
): TextureResource[] {
  const base = resolveTextureInput(input);
  const frameWidth = options.frameWidth;
  const frameHeight = options.frameHeight ?? frameWidth;
  const startX = options.startX ?? 0;
  const startY = options.startY ?? 0;
  const gapX = options.gapX ?? 0;
  const gapY = options.gapY ?? 0;

  const computedColumns =
    options.columns ??
    Math.max(
      1,
      Math.floor((base.width - startX + gapX) / (frameWidth + gapX)),
    );
  const count = options.count ?? computedColumns;
  const frames: TextureResource[] = [];

  for (let index = 0; index < count; index++) {
    const column = index % computedColumns;
    const row = Math.floor(index / computedColumns);
    const x = startX + column * (frameWidth + gapX);
    const y = startY + row * (frameHeight + gapY);

    frames.push(
      new Texture({
        source: base.source,
        frame: new Rectangle(x, y, frameWidth, frameHeight),
      }),
    );
  }

  return frames;
}
