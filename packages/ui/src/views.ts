import { NineSliceSprite } from "pixi.js";
import { resolveTextureInput } from "@yage/renderer";
import type { DisplayContainer, TextureInput } from "@yage/renderer";

export interface NineSliceViewOptions {
  texture: TextureInput;
  width: number;
  height: number;
  insets:
    | number
    | { left: number; top: number; right: number; bottom: number };
}

/** Create a resizable nine-slice display view without exposing Pixi types. */
export function createNineSliceView(
  options: NineSliceViewOptions,
): DisplayContainer {
  const texture = resolveTextureInput(options.texture);
  const insets =
    typeof options.insets === "number"
      ? {
          left: options.insets,
          top: options.insets,
          right: options.insets,
          bottom: options.insets,
        }
      : options.insets;

  const view = new NineSliceSprite({
    texture,
    leftWidth: insets.left,
    topHeight: insets.top,
    rightWidth: insets.right,
    bottomHeight: insets.bottom,
  });
  view.width = options.width;
  view.height = options.height;
  return view;
}
