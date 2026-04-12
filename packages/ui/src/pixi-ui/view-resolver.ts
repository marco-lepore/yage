import { AssetHandle } from "@yage/core";
import { resolveTextureInput } from "@yage/renderer";
import type { PixiViewType } from "../types.js";

export function resolvePixiView(
  view: PixiViewType | undefined,
): Exclude<PixiViewType, AssetHandle<unknown>> | undefined {
  if (view instanceof AssetHandle) {
    return resolveTextureInput(view);
  }
  return view;
}
