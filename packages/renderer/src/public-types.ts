import type { AssetHandle } from "@yagejs/core";
import type {
  BitmapFont,
  BitmapText,
  ColorSource,
  Container,
  FillGradient,
  Graphics,
  PointData,
  Sprite,
  Text,
  Texture,
  TextStyleOptions,
} from "pixi.js";

/** A loaded texture resource managed by the renderer. */
export type TextureResource = Texture;

/** A typed asset handle for a texture resource. */
export type TextureHandle = AssetHandle<TextureResource>;

/** A typed handle for any asset loaded by the renderer asset pipeline. */
export type RendererAsset<T = unknown> = AssetHandle<T>;

/** Any texture reference accepted by renderer helpers and components. */
export type TextureInput = string | TextureResource | TextureHandle;

/** The mutable graphics drawing context used by renderer draw callbacks. */
export type GraphicsContext = Graphics;

/** A display container used by renderer and UI APIs. */
export type DisplayContainer = Container;

/** A sprite display object. */
export type DisplaySprite = Sprite;

/** A text display object. */
export type DisplayText = Text;

/** A bitmap-font text display object. */
export type DisplayBitmapText = BitmapText;

/** A loaded bitmap font (parsed `.fnt`/`.xml` + glyph atlas). */
export type BitmapFontResource = BitmapFont;

/** A typed asset handle for a bitmap font resource. */
export type BitmapFontHandle = AssetHandle<BitmapFontResource>;

/** The `FontFace`s registered when a web font (`.ttf`/`.woff`) is loaded. */
export type WebFontResource = FontFace[];

/** A typed asset handle for a web font loaded for canvas `Text`. */
export type WebFontHandle = AssetHandle<WebFontResource>;

/**
 * Opt into bitmap-font text rendering instead of canvas-rasterised `Text`.
 *
 * Canvas text is bilinear-sampled by the GPU, so it goes blurry the moment
 * it's drawn at a non-integer scale (camera zoom, pixel-art upscaling) on a
 * non-Retina display. A `BitmapText` draws pre-baked glyph quads instead, so
 * it stays crisp.
 *
 *   - `true` — generate a dynamic bitmap font from the text's own `style`
 *     (the `fontFamily` / `fontSize` you already passed). Zero-config escape
 *     hatch for pixel-art games.
 *   - `{ font }` — render with an already installed / loaded bitmap font,
 *     selected by its registered name. `size` overrides the glyph size.
 */
export type BitmapTextOption = boolean | { font?: string; size?: number };

/** Text styling accepted by UI and text APIs. */
export type TextStyle = TextStyleOptions;

/** A gradient fill usable anywhere a PixiJS fill style is accepted. */
export type GradientFill = FillGradient;

/** Generic color input accepted by UI helpers. */
export type ColorValue = ColorSource;

/** Point-like data used by UI callbacks and options. */
export type PointLike = PointData;

/** Options for slicing a texture into frame textures. */
export interface TextureSliceOptions {
  frameWidth: number;
  frameHeight?: number;
  startX?: number;
  startY?: number;
  columns?: number;
  count?: number;
  gapX?: number;
  gapY?: number;
}
