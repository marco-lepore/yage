import { AssetHandle } from "@yagejs/core";
import type { Texture, TextureSource } from "pixi.js";
import { resolveTextureInput } from "../assets.js";
import type { SpriteMaps } from "../materials.js";

export interface ResolvedMaps {
  readonly refs: SpriteMaps;
  readonly page?: TextureSource;
  readonly normal?: Texture;
  readonly specular?: Texture;
  readonly emission?: Texture;
}

/** Resolve and validate every companion before a source replacement mutates state. */
export function resolveMaps(
  frames: readonly Texture[],
  maps: SpriteMaps = {},
): ResolvedMaps {
  const refs = Object.freeze({ ...maps });
  if (!maps.normal && !maps.specular && !maps.emission) return { refs };
  const page = frames[0]?.source;
  if (!page || frames.some((frame) => frame.source !== page)) {
    throw new Error("Sprite maps: mapped frames must use one image page.");
  }
  const result: {
    refs: SpriteMaps;
    page: TextureSource;
    normal?: Texture;
    specular?: Texture;
    emission?: Texture;
  } = { refs, page };
  for (const role of ["normal", "specular", "emission"] as const) {
    const ref = maps[role];
    if (ref === undefined) continue;
    if (
      role !== "emission" &&
      (!(ref instanceof AssetHandle) || ref.type !== "data-texture")
    ) {
      throw new Error(
        `Sprite maps.${role}: use a dataTexture(...) handle for numeric pixels.`,
      );
    }
    const texture = resolveTextureInput(ref);
    const name = typeof ref === "string" ? ref : ref.path;
    if (
      texture.source.pixelWidth !== page.pixelWidth ||
      texture.source.pixelHeight !== page.pixelHeight ||
      texture.source.resolution !== page.resolution ||
      texture.frame.x !== 0 ||
      texture.frame.y !== 0 ||
      texture.frame.width !== texture.source.width ||
      texture.frame.height !== texture.source.height
    ) {
      throw new Error(
        `Sprite maps.${role}: "${name}" must be a full ${page.pixelWidth}×${page.pixelHeight} page at resolution ${page.resolution}; got ${texture.source.pixelWidth}×${texture.source.pixelHeight} at resolution ${texture.source.resolution}.`,
      );
    }
    result[role] = texture;
  }
  return result;
}
