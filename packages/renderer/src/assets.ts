import { AssetHandle } from "@yagejs/core";
import {
  Assets,
  BitmapFont,
  BitmapFontManager,
  CanvasTextMetrics,
  NineSliceSprite,
  Rectangle,
  Texture,
  TextStyle as PixiTextStyle,
} from "pixi.js";
import type { Spritesheet } from "pixi.js";
import {
  emphasisKey,
  registerBitmapFontVariant,
  unregisterBitmapFontVariants,
  variantFontName,
  type BitmapFontEmphasis,
} from "./internal/bitmapFontVariants.js";
import type {
  BitmapFontHandle,
  RendererAsset,
  TextStyle,
  TextureHandle,
  TextureInput,
  TextureResource,
  TextureSliceOptions,
  WebFontHandle,
  WebFontResource,
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

/**
 * Declarative atlas-baking config for a {@link webFont} loaded with `bitmap`
 * set. Mirrors {@link InstallBitmapFontOptions} minus `name` / `family` — the
 * baked bitmap font registers under the same family as the canvas face, so one
 * `webFont` name drives both the canvas `Text` and the `BitmapText` registries
 * (separate registries, no collision).
 */
export interface WebFontBakeOptions {
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
   * drop shadow…). `fontFamily` / `fontSize` are managed by the baker.
   * `fill` defaults to white so per-text `fill` / `tint` can recolour the
   * glyphs — set it explicitly to bake a fixed colour instead.
   */
  style?: Partial<TextStyle>;
  /**
   * Weight/style emphasis atlases to bake alongside the base font from the
   * same source face — the same declarative model as
   * {@link InstallBitmapFontOptions.variants}. A `BitmapText` whose
   * `style.fontWeight`/`fontStyle` asks for bold or italic then renders from
   * the matching synthetic atlas.
   */
  variants?: BitmapFontVariant[];
}

/** Options for {@link webFont}. */
export interface WebFontOptions {
  /**
   * `@font-face` family the loaded face registers under — the name you then
   * pass as `style.fontFamily` on `Text` / `UIText` / `TextComponent`.
   * Omit to let Pixi derive it from the file name.
   */
  family?: string;
  /**
   * Also bake a bitmap glyph atlas from the loaded face under the same family,
   * so the one `webFont` name works for both canvas `Text` (no `bitmap`) and
   * `BitmapText` (`bitmap: true`). `true` bakes with defaults; pass a
   * {@link WebFontBakeOptions} object to control size, charset, emphasis
   * variants, and baked style.
   *
   * Requires `family` so the baked atlas has a stable name to register under
   * and uninstall on unload; baking is skipped (with a warning) when `family`
   * is omitted.
   *
   * ```ts
   * webFont("fonts/Inter.woff2", { family: "Inter", bitmap: { size: 24 } });
   * // <TextComponent style={{ fontFamily: "Inter" }} />        → canvas Text
   * // <TextComponent bitmap style={{ fontFamily: "Inter" }} /> → bitmap atlas
   * ```
   */
  bitmap?: boolean | WebFontBakeOptions;
}

/**
 * Loader metadata stashed onto a {@link webFont} handle — the `@font-face`
 * family plus the optional declarative bitmap-bake config. Read by the
 * `web-font` loader, never by user code.
 *
 * @internal
 */
export interface WebFontHandleData {
  /** `@font-face` family the loaded face registers under. */
  family?: string;
  /** Declarative bitmap-bake config, copied through from `WebFontOptions`. */
  bitmap?: boolean | WebFontBakeOptions;
}

/**
 * Create a typed asset handle for a plain web font (a `.ttf`/`.woff`/`.woff2`
 * loaded for canvas `Text`, the canvas sibling of {@link bitmapFont}). Resolve
 * it through a scene's `preload` so the face is registered before the first
 * draw — Pixi caches fallback metrics on first paint otherwise, so a font that
 * loads late never applies.
 *
 * Pass `bitmap` to also bake a `BitmapText` atlas from the same face under the
 * same family, so a single declared font works for both text paths.
 *
 * ```ts
 * class MenuScene extends Scene {
 *   readonly preload = [webFont("fonts/Inter.woff2", { family: "Inter" })];
 *   // …then: new TextComponent({ text: "Play", style: { fontFamily: "Inter" } })
 * }
 * ```
 */
export function webFont(path: string, opts?: WebFontOptions): WebFontHandle {
  const data: WebFontHandleData = {
    ...(opts?.family !== undefined ? { family: opts.family } : {}),
    ...(opts?.bitmap !== undefined ? { bitmap: opts.bitmap } : {}),
  };
  return new AssetHandle(
    "web-font",
    path,
    Object.keys(data).length > 0 ? data : undefined,
  );
}

/**
 * Bitmap fonts a single web-font load installed, keyed by the load path so the
 * `web-font` loader can `BitmapFont.uninstall` them on unload — which only
 * receives `(path, asset)`, never the handle's bake config. Holds the base
 * family plus every baked emphasis-variant name.
 *
 * @internal
 */
const bakedWebFontFamilies = new Map<string, string[]>();

/**
 * Load a web font for the `web-font` asset loader, optionally baking a bitmap
 * atlas under the same family when `data.bitmap` is set. Returns the loaded
 * `FontFace[]` so the asset cache holds the canvas face as before.
 *
 * Split out of the loader registration so the bake/teardown logic is unit
 * testable against the same Pixi mock as {@link installBitmapFont}.
 *
 * @internal
 */
export async function loadWebFont(
  path: string,
  data?: unknown,
): Promise<WebFontResource> {
  const meta = data as WebFontHandleData | undefined;
  const family = meta?.family;
  const faces = await Assets.load<WebFontResource>(
    family !== undefined ? { src: path, data: { family } } : path,
  );

  if (meta?.bitmap) {
    if (family === undefined) {
      console.warn(
        `webFont("${path}", { bitmap }) needs an explicit \`family\` to name ` +
          `the baked atlas — skipping the bitmap bake.`,
      );
    } else {
      const bake = meta.bitmap === true ? {} : meta.bitmap;
      bakedWebFontFamilies.set(
        path,
        bakeBitmapFontFamily(family, family, bake),
      );
    }
  }

  return faces;
}

/**
 * Unload a web font for the `web-font` asset loader: drop the canvas face via
 * `Assets.unload` and `BitmapFont.uninstall` every atlas baked for it. The
 * core loader's `unload(path, asset)` never sees the handle's bake config, so
 * the baked family names are recovered from {@link bakedWebFontFamilies}.
 *
 * @internal
 */
export function unloadWebFont(path: string): void {
  Assets.unload(path);
  const names = bakedWebFontFamilies.get(path);
  if (names) {
    for (const name of names) BitmapFont.uninstall(name);
    // The base name (first entry) is the family a `BitmapText` resolves
    // variants under — drop its registry entries too so a request after
    // unload no longer maps to a destroyed atlas.
    if (names[0] !== undefined) unregisterBitmapFontVariants(names[0]);
    bakedWebFontFamilies.delete(path);
  }
}

/** Drop the baked-web-font tracking — test isolation only. @internal */
export function clearBakedWebFontFamilies(): void {
  bakedWebFontFamilies.clear();
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
  /**
   * Bake weight/style emphasis atlases alongside the base font from the same
   * source `.ttf`, so a `BitmapText` whose `style.fontWeight`/`fontStyle`
   * asks for bold or italic renders from the matching synthetic atlas instead
   * of being ignored (canvas `Text` honours those props; plain `BitmapText`
   * does not).
   *
   * Every variant is baked through the same pipeline as the base, then has
   * its baseline metrics aligned to the base atlas — so a bold span and
   * regular text sit on one shared baseline with no vertical drift. Variants
   * register under derived names (`"<name> bold"`, `"<name> italic"`, …); you
   * never name them yourself. Just set `style.fontWeight: "bold"` on a
   * `BitmapText` using this font and the bold atlas is selected automatically.
   *
   * ```ts
   * await installBitmapFont("fonts/Body.ttf", {
   *   name: "Body",
   *   variants: [{ fontWeight: "bold" }, { fontStyle: "italic" }],
   * });
   * // <BitmapText style={{ fontFamily: "Body", fontWeight: "bold" }} /> → bold atlas
   * ```
   */
  variants?: BitmapFontVariant[];
}

/**
 * One weight/style emphasis to bake as a sibling atlas of a base bitmap font.
 * Identified by the `fontWeight`/`fontStyle` a `BitmapText` will ask for — a
 * variant only differs from the base along the bold and italic axes, so a
 * request for `fontWeight: "700"` resolves the atlas baked for
 * `fontWeight: "bold"`.
 *
 * This is the declarative shape the loader-level bitmap-font config reuses, so
 * the same `variants` array can be authored inline or hung off an asset
 * manifest.
 */
export interface BitmapFontVariant {
  /**
   * Weight to synthesise this variant at. Keyword (`"bold"`) or numeric
   * string (`"700"`); >= 600 (or `"bold"`/`"bolder"`) selects the bold axis.
   */
  fontWeight?: TextStyle["fontWeight"];
  /** Slant to synthesise this variant at — `"italic"` or `"oblique"`. */
  fontStyle?: TextStyle["fontStyle"];
  /**
   * Extra `TextStyle` props baked into this variant's glyphs only, layered
   * over the base font's `style`. `fontFamily` / `fontSize` /
   * `fontWeight` / `fontStyle` are managed by the variant pipeline.
   */
  style?: Partial<TextStyle>;
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

  bakeBitmapFontFamily(opts.name, family, {
    ...(opts.size !== undefined ? { size: opts.size } : {}),
    ...(opts.chars !== undefined ? { chars: opts.chars } : {}),
    ...(opts.resolution !== undefined ? { resolution: opts.resolution } : {}),
    ...(opts.padding !== undefined ? { padding: opts.padding } : {}),
    ...(opts.style !== undefined ? { style: opts.style } : {}),
    ...(opts.variants !== undefined ? { variants: opts.variants } : {}),
  });

  return opts.name;
}

/**
 * Bake the base atlas for `name` from an already-loaded `family` face, plus
 * any declared emphasis variants, registering each so a `BitmapText` resolves
 * the right sibling. Returns every installed font name (base first) so a
 * caller that owns the loaded face — the `web-font` loader — can uninstall the
 * whole set on unload.
 *
 * Shared by {@link installBitmapFont} (one-shot `.ttf` bake) and the `web-font`
 * loader (declarative `webFont({ bitmap })`), so both bake an identical family.
 */
function bakeBitmapFontFamily(
  name: string,
  family: string,
  opts: WebFontBakeOptions,
): string[] {
  // Shared bake params reused by the base atlas and every variant, so the
  // whole family is sized/charset/padded identically and only the emphasis
  // axes differ between siblings.
  const shared = {
    family,
    ...(opts.size !== undefined ? { size: opts.size } : {}),
    ...(opts.chars !== undefined ? { chars: opts.chars } : {}),
    ...(opts.resolution !== undefined ? { resolution: opts.resolution } : {}),
    ...(opts.padding !== undefined ? { padding: opts.padding } : {}),
    ...(opts.style !== undefined ? { style: opts.style } : {}),
  } satisfies Omit<BakeBitmapFontParams, "name">;

  const baseFont = bakeBitmapFont({ name, ...shared });
  const installed: string[] = [name];

  // The base atlas registers itself as the regular variant so a `BitmapText`
  // with an explicit `fontWeight: "normal"` resolves back to it.
  if (opts.variants && opts.variants.length > 0) {
    // Re-installing the same font name with a smaller / different variant set
    // would otherwise inherit stale emphasis entries from the previous install
    // (the registry is process-global), so wipe this name's slate first.
    unregisterBitmapFontVariants(name);
    const baseKey = emphasisKey({});
    registerBitmapFontVariant(name, {}, name);

    for (const variant of opts.variants) {
      const emphasis: BitmapFontEmphasis = {
        ...(variant.fontWeight !== undefined
          ? { fontWeight: variant.fontWeight }
          : {}),
        ...(variant.fontStyle !== undefined
          ? { fontStyle: variant.fontStyle }
          : {}),
      };
      // A variant whose weight/style doesn't cross the bold or italic axis
      // (e.g. `{ fontWeight: "lighter" }`) collapses onto the base — skip it
      // rather than re-bake and clobber the regular atlas under its own name.
      if (emphasisKey(emphasis) === baseKey) continue;
      const variantName = variantFontName(name, emphasis);
      const variantFont = bakeBitmapFont({
        name: variantName,
        ...shared,
        style: {
          ...shared.style,
          ...variant.style,
          ...(variant.fontWeight !== undefined
            ? { fontWeight: variant.fontWeight }
            : {}),
          ...(variant.fontStyle !== undefined
            ? { fontStyle: variant.fontStyle }
            : {}),
        },
      });
      // Synthesised bold/italic measure to a different baseline offset and
      // line height than the regular face even from the same source, which
      // drifts a mixed-weight line vertically (issue #109). Align the variant
      // to the base so siblings are baseline-interchangeable.
      alignBaselineMetrics(variantFont, baseFont);
      registerBitmapFontVariant(name, emphasis, variantName);
      installed.push(variantName);
    }
  }

  return installed;
}

/**
 * Copy the reference font's vertical metrics onto a variant so both lay glyphs
 * out on one baseline. `getBitmapTextLayout` seeds `offsetY` from
 * `baseLineOffset` and advances lines by `lineHeight`, so matching those two
 * is what keeps a mixed-emphasis line aligned.
 */
function alignBaselineMetrics(
  variant: BakedFontMetrics,
  reference: BakedFontMetrics,
): void {
  variant.baseLineOffset = reference.baseLineOffset;
  variant.lineHeight = reference.lineHeight;
}

/**
 * The two vertical metrics a baked bitmap font lays glyphs out from, exposed
 * as a writable view so variant baselines can be aligned to the base. Pixi
 * types these `readonly` on `AbstractBitmapFont` and they're inert plain
 * fields at runtime, so writing them is safe — and required to fix #109. The
 * font instance is also Pixi's runtime return of `BitmapFont.install`, which
 * its types declare as `void`.
 */
interface BakedFontMetrics {
  /** Glyph offset from the line baseline (px). */
  baseLineOffset: number;
  /** Line advance (px). */
  lineHeight: number;
}

/** Parameters for {@link bakeBitmapFont}. */
interface BakeBitmapFontParams {
  /** Name to register the baked font under. */
  name: string;
  /** `@font-face` family the loaded face is registered under. */
  family: string;
  /** Glyph size (px) to bake the atlas at. Default `32`. */
  size?: number;
  /** Character set to bake (Pixi range syntax). Defaults to Pixi's set. */
  chars?: string | (string | string[])[];
  /** Atlas resolution multiplier. Default `2`. */
  resolution?: number;
  /** Glyph padding in the atlas. Default `4`. */
  padding?: number;
  /** Extra `TextStyle` props baked into every glyph. */
  style?: Partial<TextStyle>;
}

/**
 * Bake a bitmap glyph atlas from an already-loaded font face via Pixi v8's
 * `BitmapFont.install`. Assumes `family` is registered (e.g. by an
 * `Assets.load` of the source `.ttf`). The single chokepoint that turns a
 * loaded face into a registered bitmap font. Returns the installed font's
 * writable baseline metrics so callers can read or align them (e.g. baseline
 * normalization across emphasis variants).
 */
function bakeBitmapFont(params: BakeBitmapFontParams): BakedFontMetrics {
  // Pixi types `install` as returning `void` but it returns the installed
  // DynamicBitmapFont at runtime; we only need its (runtime-mutable) baseline
  // metrics to normalize emphasis variants onto a shared baseline.
  const font = BitmapFont.install({
    name: params.name,
    style: {
      // Bake glyphs white by default so per-text `fill` / `tint` (a multiply
      // over the atlas) can colour them — a black atlas yields `black × tint
      // = black`. A caller-supplied `style.fill` still wins.
      fill: 0xffffff,
      ...params.style,
      fontFamily: params.family,
      fontSize: params.size ?? 32,
    },
    resolution: params.resolution ?? 2,
    padding: params.padding ?? 4,
    ...(params.chars !== undefined ? { chars: params.chars } : {}),
  }) as unknown as BakedFontMetrics;
  return font;
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

/** Options for {@link createNineSlice}. Slice insets follow pixi's `NineSliceSprite`. */
export interface NineSliceOptions {
  /** Frame {@link TextureInput} — handle, asset key, or raw `Texture`. */
  readonly texture: TextureInput;
  /** Left slice-guide inset (source px). */
  readonly leftWidth: number;
  /** Top slice-guide inset (source px). */
  readonly topHeight: number;
  /** Right slice-guide inset (source px). */
  readonly rightWidth: number;
  /** Bottom slice-guide inset (source px). */
  readonly bottomHeight: number;
  /** Rendered width (px) the frame stretches to. */
  readonly width: number;
  /** Rendered height (px) the frame stretches to. */
  readonly height: number;
}

/**
 * Build a `NineSliceSprite` from an engine-resolved {@link TextureInput} — a
 * stretchable textured frame whose corners stay crisp at any size. Returns the
 * raw display object so callers can parent it into their own container, the
 * same escape-hatch shape as {@link resolveTextureInput}. This is the renderer's
 * nine-slice primitive: reach for it (not a direct `pixi.js` import) when
 * building textured panels, dialogue/UI frames, or buttons.
 *
 * `width`/`height` are required: a nine-slice is stretched to a target size, and
 * defaulting to the (possibly unloaded → 0×0) texture size would silently bake a
 * degenerate frame.
 */
export function createNineSlice(options: NineSliceOptions): NineSliceSprite {
  return new NineSliceSprite({
    texture: resolveTextureInput(options.texture),
    leftWidth: options.leftWidth,
    topHeight: options.topHeight,
    rightWidth: options.rightWidth,
    bottomHeight: options.bottomHeight,
    width: options.width,
    height: options.height,
  });
}

/** Inputs for {@link measureWrappedText}. */
export interface MeasureTextOptions {
  /** Canvas font family (or a baked bitmap-font name when `bitmap`). */
  readonly fontFamily?: string;
  /** Font size in px. */
  readonly fontSize: number;
  /** Vertical advance per line in px (defaults to the font's natural height). */
  readonly lineHeight?: number;
  /** Wrap width in px. Omit or `<= 0` to measure a single unwrapped line. */
  readonly wordWrapWidth?: number;
  /**
   * Measure via the bitmap-font path (`BitmapFontManager`). Bitmap metrics do
   * **not** word-wrap, so the result is single-line — callers using a bitmap
   * font should keep fixed sizing rather than grow to wrapped content.
   */
  readonly bitmap?: boolean;
}

/** Natural laid-out size of a (optionally wrapped) text string. */
export interface MeasuredText {
  readonly width: number;
  readonly height: number;
  /** Number of laid-out lines (wrap-aware on the canvas path; `>= 1`). */
  readonly lineCount: number;
}

/**
 * Measure the natural size of a text string — wrap-aware on the canvas path —
 * without constructing a live text node. This is the renderer's text-metrics
 * primitive: reach for it (not a direct `pixi.js` import) when a layout needs to
 * size a panel to its text (e.g. a content-sized dialogue bubble).
 *
 * Canvas path uses Pixi's `CanvasTextMetrics` and honours `wordWrapWidth`, so
 * `lineCount` reflects the wrapped line count. The bitmap path
 * (`BitmapFontManager`) has no wrap support and returns single-line metrics.
 *
 * Requires a DOM/canvas at runtime (the browser) for the canvas path; unit tests
 * mock `CanvasTextMetrics` (there is no canvas under the node test env).
 */
export function measureWrappedText(
  text: string,
  options: MeasureTextOptions,
): MeasuredText {
  const wrap = options.wordWrapWidth !== undefined && options.wordWrapWidth > 0;
  const style = new PixiTextStyle({
    fontSize: options.fontSize,
    ...(options.fontFamily !== undefined
      ? { fontFamily: options.fontFamily }
      : {}),
    ...(options.lineHeight !== undefined
      ? { lineHeight: options.lineHeight }
      : {}),
    wordWrap: wrap,
    ...(wrap ? { wordWrapWidth: options.wordWrapWidth } : {}),
  });
  if (options.bitmap) {
    const m = BitmapFontManager.measureText(text, style);
    return { width: m.width, height: m.height, lineCount: text.split("\n").length };
  }
  const m = CanvasTextMetrics.measureText(text, style);
  return { width: m.width, height: m.height, lineCount: m.lines.length };
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
    Math.max(1, Math.floor((base.width - startX + gapX) / (frameWidth + gapX)));
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
