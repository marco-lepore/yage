import { AssetHandle } from "@yagejs/core";
import { Assets, BitmapFont, Rectangle, Texture } from "pixi.js";
import type { Spritesheet } from "pixi.js";
import type {
  BitmapFontHandle,
  RendererAsset,
  TextStyle,
  TextureHandle,
  TextureInput,
  TextureResource,
  TextureSliceOptions,
  WebFontHandle,
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

/**
 * Create a typed asset handle for a bitmap font — a BMFont `.fnt`/`.xml`
 * descriptor plus its glyph atlas. Resolve it through the asset manager
 * (`engine.assets`) like any other handle; the loaded font registers itself
 * under the `fontFamily` declared in the descriptor, so pass that same name
 * as `style.fontFamily` (with `bitmap: true`) on `UIText` / `TextComponent`.
 *
 * For runtime-baked fonts from a `.ttf` instead, see {@link installBitmapFont}.
 */
export function bitmapFont(path: string): BitmapFontHandle {
  return new AssetHandle("bitmap-font", path);
}

/** Options for {@link webFont}. */
export interface WebFontOptions {
  /**
   * `@font-face` family the loaded face registers under — the name you then
   * pass as `style.fontFamily` on `Text` / `UIText` / `TextComponent`.
   * Omit to let Pixi derive it from the file name.
   */
  family?: string;
}

/**
 * Create a typed asset handle for a plain web font (a `.ttf`/`.woff`/`.woff2`
 * loaded for canvas `Text`, the canvas sibling of {@link bitmapFont}). Resolve
 * it through a scene's `preload` so the face is registered before the first
 * draw — Pixi caches fallback metrics on first paint otherwise, so a font that
 * loads late never applies.
 *
 * ```ts
 * class MenuScene extends Scene {
 *   readonly preload = [webFont("fonts/Inter.woff2", { family: "Inter" })];
 *   // …then: new TextComponent({ text: "Play", style: { fontFamily: "Inter" } })
 * }
 * ```
 */
export function webFont(path: string, opts?: WebFontOptions): WebFontHandle {
  return new AssetHandle(
    "web-font",
    path,
    opts?.family !== undefined ? { family: opts.family } : undefined,
  );
}

/** Options for {@link installBitmapFont}. */
export interface InstallBitmapFontOptions {
  /**
   * Name to register the baked font under. This is what you pass as
   * `style.fontFamily` (alongside `bitmap: true`) on `UIText` /
   * `TextComponent`, and what `installBitmapFont` returns.
   */
  name: string;
  /** Glyph size (px) to bake the atlas at. Default `32`. */
  size?: number;
  /**
   * Character set to bake. Accepts Pixi's range syntax, e.g.
   * `[["a", "z"], ["A", "Z"], "0123456789 .,!?"]`. Defaults to Pixi's
   * alphanumeric set — remember to include a space.
   */
  chars?: string | (string | string[])[];
  /**
   * Atlas resolution multiplier. `2` keeps glyphs crisp when the text is
   * upscaled by a pixel-art camera. Default `2`.
   */
  resolution?: number;
  /** Glyph padding in the atlas. Default `4`. */
  padding?: number;
  /**
   * Extra `TextStyle` props baked into every glyph (fill, stroke, weight,
   * drop shadow…). `fontFamily` / `fontSize` are managed by this helper.
   * `fill` defaults to white so per-text `fill` / `tint` can recolour the
   * glyphs — set it explicitly to bake a fixed colour instead.
   */
  style?: Partial<TextStyle>;
  /**
   * `@font-face` family the loaded `.ttf` registers under. Defaults to
   * `name`, so the loaded face and the baked bitmap font share one
   * coherent identifier.
   */
  family?: string;
}

/**
 * Load a `.ttf`/`.woff` and bake a bitmap glyph atlas from it via Pixi v8's
 * `BitmapFont.install`. Returns the registered font name, ready to hand to
 * `style.fontFamily` (with `bitmap: true`) on `UIText` / `TextComponent`.
 *
 * ```ts
 * const font = await installBitmapFont("fonts/PressStart2P.ttf", {
 *   name: "PressStart",
 *   size: 16,
 * });
 * entity.add(
 *   new TextComponent({ text: "READY", bitmap: true, style: { fontFamily: font } }),
 * );
 * ```
 */
export async function installBitmapFont(
  source: string | AssetHandle<unknown>,
  opts: InstallBitmapFontOptions,
): Promise<string> {
  const path = typeof source === "string" ? source : source.path;
  const family = opts.family ?? opts.name;

  await Assets.load({ src: path, data: { family } });

  BitmapFont.install({
    name: opts.name,
    style: {
      // Bake glyphs white by default so per-text `fill` / `tint` (a multiply
      // over the atlas) can colour them — a black atlas yields `black × tint
      // = black`. A caller-supplied `style.fill` still wins.
      fill: 0xffffff,
      ...opts.style,
      fontFamily: family,
      fontSize: opts.size ?? 32,
    },
    resolution: opts.resolution ?? 2,
    padding: opts.padding ?? 4,
    ...(opts.chars !== undefined ? { chars: opts.chars } : {}),
  });

  return opts.name;
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
