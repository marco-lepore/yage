import type { AssetHandle } from "@yagejs/core";
import type {
  AnimatedSprite,
  Application as PixiApplication,
  ApplicationOptions as PixiApplicationOptions,
  BitmapFont,
  BitmapText,
  ColorSource,
  Container,
  DestroyOptions as PixiDestroyOptions,
  Filter as PixiFilter,
  FillGradient,
  Graphics,
  NineSliceSprite as PixiNineSliceSprite,
  Particle as PixiParticle,
  ParticleContainer as PixiParticleContainer,
  PointData,
  Sprite,
  SplitBitmapText,
  SplitText,
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

/** An animated-sprite display object (`AnimatedSpriteComponent`'s render object). */
export type DisplayAnimatedSprite = AnimatedSprite;

/** A per-character/word/line split canvas-text display object (`SplitTextComponent`'s canvas render object). */
export type DisplaySplitText = SplitText;

/** A per-character/word/line split bitmap-text display object (`SplitTextComponent`'s bitmap render object). */
export type DisplaySplitBitmapText = SplitBitmapText;

/** A nine-slice display object, as built by `createNineSlice` / `UINineSlice`. */
export type NineSliceSprite = PixiNineSliceSprite;

/** A pixi filter (or chain of filters), as attached through the effects API or `rawFilter`. */
export type Filter = PixiFilter;

/** A GPU-batched particle container, as owned by `@yagejs-addons`/`@yagejs/particles`' emitter components. */
export type ParticleContainer = PixiParticleContainer;

/** A single GPU-batched particle, as pooled and emitted by `@yagejs/particles`. */
export type Particle = PixiParticle;

/** The underlying PixiJS `Application` instance — see `RendererPlugin.application`. */
export type Application = PixiApplication;

/** Options accepted by the PixiJS `Application` — see `RendererConfig.pixi`. */
export type ApplicationOptions = PixiApplicationOptions;

/** Options for `Container.destroy()`, as returned by a visual component's `destroyOptions()` hook. */
export type DestroyOptions = PixiDestroyOptions;

/** A loaded bitmap font (parsed `.fnt`/`.xml` + glyph atlas). */
export type BitmapFontResource = BitmapFont;

/** A typed asset handle for a bitmap font resource. */
export type BitmapFontHandle = AssetHandle<BitmapFontResource>;

/** The `FontFace`s registered when a web font (`.ttf`/`.woff`) is loaded. */
export type WebFontResource = FontFace[];

/** A typed asset handle for a web font loaded for canvas `Text`. */
export type WebFontHandle = AssetHandle<WebFontResource>;

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
