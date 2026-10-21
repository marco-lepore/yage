import { AssetHandle } from "@yagejs/core";
import { Assets, ImageSource, Texture, getResolutionOfUrl } from "pixi.js";
import type { TextureOptions } from "./assets.js";
import type { DataTextureHandle, DataTextureResource } from "./public-types.js";

/** Load numeric PNG channels without color conversion or premultiplication. */
export function dataTexture(
  path: string,
  options?: TextureOptions,
): DataTextureHandle {
  return new AssetHandle(
    "data-texture",
    path,
    options?.scaleMode === undefined
      ? undefined
      : { scaleMode: options.scaleMode },
  );
}

/** @internal Numeric and color imports of one URL never share a Pixi entry. */
export function dataTextureKey(path: string): string {
  return `yage:data-texture:${path}`;
}

/** @internal Owned by the existing AssetManager loader. */
export async function loadDataTexture(
  path: string,
  data?: unknown,
): Promise<DataTextureResource> {
  const response = await fetch(path);
  if (!response.ok)
    throw new Error(
      `dataTexture: failed to load "${path}" (${response.status}).`,
    );
  const bytes = await response.arrayBuffer();
  const signature = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8));
  if (
    ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => signature[i] === byte)
  ) {
    throw new Error(`dataTexture: "${path}" must be a lossless PNG image.`);
  }
  if (typeof createImageBitmap !== "function") {
    throw new Error(
      "dataTexture: this browser cannot decode numeric images without color conversion.",
    );
  }
  const bitmap = await createImageBitmap(
    new Blob([bytes], { type: "image/png" }),
    {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
      imageOrientation: "none",
    },
  );
  const scaleMode = (data as TextureOptions | undefined)?.scaleMode;
  const texture = new Texture({
    source: new ImageSource({
      resource: bitmap,
      resolution: getResolutionOfUrl(path),
      alphaMode: "no-premultiply-alpha",
      format: "rgba8unorm",
      ...(scaleMode === undefined ? {} : { scaleMode }),
      label: dataTextureKey(path),
    }),
  }) as DataTextureResource;
  Assets.cache.set(dataTextureKey(path), texture);
  return texture;
}

/** @internal Release only the data import, never the color resource at path. */
export function unloadDataTexture(
  path: string,
  texture: DataTextureResource,
): void {
  Assets.cache.remove(dataTextureKey(path));
  (texture.source.resource as ImageBitmap).close();
  texture.destroy(true);
}
