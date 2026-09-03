import { AssetHandle } from "@yagejs/core";
import {
  Assets,
  BitmapFont,
  BitmapFontManager,
  CanvasTextMetrics,
  NineSliceSprite as PixiNineSliceSprite,
  Texture,
  TextStyle as PixiTextStyle,
} from "pixi.js";
import type { Spritesheet } from "pixi.js";
import { sliceGrid } from "./spritesheet.js";
import {
  emphasisKey,
  registerBitmapFontVariant,
  unregisterBitmapFontVariants,
  variantFontName,
  type BitmapFontEmphasis,
} from "./internal/bitmapFontVariants.js";
import {
  acquireBakedFamily,
  releaseBakedFamily,
} from "./internal/bitmapFontRegistry.js";
import {
  resolveTextStyle,
  selectBitmapVariant,
} from "./internal/textConstruction.js";
import type {
  BitmapFontHandle,
  NineSliceSprite,
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
 * Base family a web-font load baked a bitmap atlas for, keyed by the load path.
 * The `web-font` loader's `unload(path, asset)` never sees the handle's bake
 * config, so this recovers which baked family to release (the actual names to
 * uninstall come from the ref-counted {@link releaseBakedFamily} ledger).
 *
 * @internal
 */
const bakedWebFontFamilies = new Map<string, string>();

/**
 * Source `.ttf`/`.woff` path each {@link installBitmapFont} loaded, keyed by the
 * registered font name, so {@link uninstallBitmapFont} — which only receives the
 * name — can `Assets.unload` the face it loaded, symmetric with the install.
 *
 * @internal
 */
const installedBitmapFontSources = new Map<string, string>();

/** Owner key a `webFont({ bitmap })` load holds its baked family under. */
function webFontOwner(path: string): string {
  return `web-font:${path}`;
}

/** Owner key an `installBitmapFont` call holds its baked family under. */
function installOwner(name: string): string {
  return `install:${name}`;
}

/**
 * Release one owner's hold on the baked family `baseName`, performing the real
 * Pixi teardown only when it was the last owner: `BitmapFont.uninstall` every
 * atlas (base + variants) and drop the family's emphasis-variant registry so a
 * later request no longer resolves a destroyed atlas. A no-op while another
 * owner (a second `webFont` load, or an `installBitmapFont` sharing the family)
 * still holds it.
 *
 * @internal
 */
function teardownBakedFamily(owner: string, baseName: string): void {
  const names = releaseBakedFamily(owner, baseName);
  if (!names) return;
  for (const name of names) BitmapFont.uninstall(name);
  unregisterBitmapFontVariants(baseName);
}

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
      const names = bakeBitmapFontFamily(family, family, bake);
      bakedWebFontFamilies.set(path, family);
      // Hold the baked family under this load's owner key so a teardown only
      // fires once every owner (other loads, a same-family installBitmapFont)
      // has released it.
      acquireBakedFamily(webFontOwner(path), family, names);
    }
  }

  return faces;
}

/**
 * Unload a web font for the `web-font` asset loader: drop this load's canvas
 * face via `Assets.unload` and release its hold on any baked bitmap family. The
 * baked atlas is `BitmapFont.uninstall`ed only when no other owner still holds
 * the family — see {@link teardownBakedFamily}. The core loader's
 * `unload(path, asset)` never sees the handle's bake config, so the baked
 * family is recovered from {@link bakedWebFontFamilies}.
 *
 * @internal
 */
export function unloadWebFont(path: string): void {
  Assets.unload(path);
  const family = bakedWebFontFamilies.get(path);
  if (family !== undefined) {
    bakedWebFontFamilies.delete(path);
    teardownBakedFamily(webFontOwner(path), family);
  }
}

/** Drop the baked-web-font tracking — test isolation only. @internal */
export function clearBakedWebFontFamilies(): void {
  bakedWebFontFamilies.clear();
}

/** Drop the install-font source tracking — test isolation only. @internal */
export function clearInstalledBitmapFontSources(): void {
  installedBitmapFontSources.clear();
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
 * `style.fontFamily` (with `bitmap: true`) on `UIText` / `TextComponent`. Pair
 * with {@link uninstallBitmapFont} to free the atlas when it's no longer used.
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

  const names = bakeBitmapFontFamily(opts.name, family, {
    ...(opts.size !== undefined ? { size: opts.size } : {}),
    ...(opts.chars !== undefined ? { chars: opts.chars } : {}),
    ...(opts.resolution !== undefined ? { resolution: opts.resolution } : {}),
    ...(opts.padding !== undefined ? { padding: opts.padding } : {}),
    ...(opts.style !== undefined ? { style: opts.style } : {}),
    ...(opts.variants !== undefined ? { variants: opts.variants } : {}),
  });

  // Remember the source face so `uninstallBitmapFont` can drop it, and hold the
  // baked family under a stable per-name owner key — re-installing the same
  // name re-bakes but stays one owner (no leaked reference).
  installedBitmapFontSources.set(opts.name, path);
  acquireBakedFamily(installOwner(opts.name), opts.name, names);

  return opts.name;
}

/**
 * Tear down a font installed by {@link installBitmapFont}: drop its source face
 * and free the baked atlas (and every emphasis variant) plus its registry
 * entries. The symmetric counterpart of `installBitmapFont` — without it an
 * install-once font's atlas lives until the page unloads.
 *
 * Safe to interleave with a `webFont({ bitmap })` sharing the same family: the
 * atlas is reference-counted, so it's only destroyed once the last owner (this
 * install and any web-font load) has released it. A no-op for a name that was
 * never installed.
 *
 * ```ts
 * const font = await installBitmapFont("fonts/PressStart2P.ttf", { name: "PressStart" });
 * // …later, when nothing renders with it anymore:
 * uninstallBitmapFont(font);
 * ```
 */
export function uninstallBitmapFont(name: string): void {
  const path = installedBitmapFontSources.get(name);
  if (path !== undefined) {
    Assets.unload(path);
    installedBitmapFontSources.delete(name);
  }
  teardownBakedFamily(installOwner(name), name);
}

/**
 * Keys currently held by {@link registerTexture}, so registration can tell its
 * own cache entries apart from loaded-asset entries (which it must never
 * shadow) and re-registration can replace without Pixi's duplicate-key warn.
 *
 * @internal
 */
const registeredTextures = new Map<string, TextureResource>();

/**
 * Register a runtime-created texture under an asset key, so every key-based
 * surface resolves it exactly like a preloaded asset: `texture: key` on
 * `SpriteComponent` and on a particle emitter, and `{ sheet: key, frameWidth }`
 * on a `FrameSource`.
 *
 * Registered keys are engine-global and live until {@link unregisterTexture} —
 * registration is a boot-scoped act, outside the asset manager's ref counts
 * and unloads. A game-owned save root can store the key, but the game must
 * re-register runtime textures under the same keys during boot before it
 * reconstructs scenes and components. Resolving a missing key throws and
 * names the key.
 *
 * Re-registering a key this API still owns replaces the cache entry;
 * components constructed before the replacement keep the old texture instance
 * (resolution happens at construction). A key present in the cache but owned
 * by the asset pipeline — a loaded asset's path, or an asset that overwrote a
 * stale registration — throws: shadowing a loaded asset would let that asset's
 * unload destroy the registered texture later.
 *
 * ```ts
 * const strip = renderer.createTexture((g) => {
 *   for (let i = 0; i < 4; i++) g.circle(i * 32 + 16, 16, 4 + i * 3).fill(0xffcc00);
 * });
 * registerTexture("boss-idle", strip);
 * entity.add(new AnimatedSpriteComponent({ source: { sheet: "boss-idle", frameWidth: 32 } }));
 * ```
 */
export function registerTexture(key: string, texture: TextureResource): void {
  const registered = registeredTextures.get(key);
  if (registered !== undefined && Assets.cache.get(key) === registered) {
    // Replacing our own prior registration.
    Assets.cache.remove(key);
  } else if (Assets.cache.has(key)) {
    // A loaded asset's key, or an asset that overwrote a stale registration —
    // foreign either way: shadowing it would let the asset's unload destroy
    // the registered texture later.
    throw new Error(
      `registerTexture("${key}"): the key is already used by a loaded asset — ` +
        `pick a key that doesn't collide with an asset path.`,
    );
  }
  Assets.cache.set(key, texture);
  registeredTextures.set(key, texture);
}

/**
 * Remove a texture registered by {@link registerTexture}. A no-op for keys
 * this API never registered. Never destroys the texture — the creator owns
 * the GPU resource; call `texture.destroy()` once nothing draws it anymore.
 *
 * Only evicts the cache entry while it still holds the registered texture: if
 * an asset preloaded under the same key overwrote it after registration, that
 * entry belongs to the asset pipeline and is left in place.
 */
export function unregisterTexture(key: string): void {
  const registered = registeredTextures.get(key);
  if (registered === undefined) return;
  if (Assets.cache.get(key) === registered) Assets.cache.remove(key);
  registeredTextures.delete(key);
}

/** Drop every registered texture entry — test isolation only. @internal */
export function clearRegisteredTextures(): void {
  for (const [key, texture] of registeredTextures) {
    if (Assets.cache.get(key) === texture) Assets.cache.remove(key);
  }
  registeredTextures.clear();
}

/**
 * Bake the base atlas for `name` from an already-loaded `family` face, plus
 * any declared emphasis variants, registering each so a `BitmapText` resolves
 * the right sibling. Returns every installed font name (base first) so the
 * caller can hold the family in the reference-counted ledger
 * ({@link acquireBakedFamily}) and uninstall the whole set on final release.
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

/**
 * Resolve a texture input into a concrete texture resource. Keys and handles
 * resolve from the global asset cache — preloaded assets and
 * {@link registerTexture} entries; an unresolvable key throws rather than
 * handing the caller an empty texture.
 */
export function resolveTextureInput(input: TextureInput): TextureResource {
  if (input instanceof AssetHandle || typeof input === "string") {
    const key = typeof input === "string" ? input : input.path;
    const resolved = Texture.from(key) as TextureResource | undefined;
    if (!resolved) {
      throw new Error(
        `Texture "${key}" is not loaded — preload it or register it with registerTexture().`,
      );
    }
    return resolved;
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
  return new PixiNineSliceSprite({
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
   * Measure via the bitmap-font path (`BitmapFontManager`): `fontFamily` names
   * a baked atlas. Wrap-aware like the canvas path, and returns px (the atlas's
   * base-unit metrics are scaled to `fontSize`).
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
 * One reused mutable style for all measurement. Pixi keys its metrics caches on
 * `style.styleKey` = `${uid}-${tick}` (identity-based), so a fresh `TextStyle`
 * per call could never hit and would push a dead entry into the 1000-slot LRU
 * each time. Reusing one instance keeps the key stable across identical
 * consecutive measures (pixi setters no-op on same-value writes). Lazy so
 * importing this module never constructs pixi state.
 */
let measureStyle: PixiTextStyle | undefined;
/** Style keys applied by the previous measure (to reset what this one omits). */
let measureStyleKeys: readonly string[] = [];

/** Apply `resolved` onto the shared measurement style, clearing leftovers. */
function applyMeasureStyle(resolved: TextStyle): PixiTextStyle {
  const style = (measureStyle ??= new PixiTextStyle());
  const target = style as unknown as Record<string, unknown>;
  const next = resolved as Record<string, unknown>;
  const defaults = PixiTextStyle.defaultTextStyle as Record<string, unknown>;
  for (const key of measureStyleKeys) {
    if (!(key in next)) target[key] = defaults[key];
  }
  for (const key in next) target[key] = next[key];
  measureStyleKeys = Object.keys(next);
  return style;
}

/**
 * Measure the natural size of a text string — wrap-aware — without constructing
 * a live text node. This is the renderer's text-metrics primitive: reach for it
 * (not a direct `pixi.js` import) when a layout needs to size a panel to its
 * text (e.g. a content-sized dialogue bubble).
 *
 * Both paths honour `wordWrapWidth`, so `lineCount` reflects the wrapped line
 * count: canvas via Pixi's `CanvasTextMetrics`, bitmap via `BitmapFontManager`
 * (whose base-unit metrics are scaled to `fontSize`, matching what a
 * `BitmapText` renders at). Measurement resolves the engine-level
 * `defaultTextStyle` under the given options — the same merge the render path
 * applies — so the measured box matches the drawn text.
 *
 * Requires a DOM/canvas at runtime (the browser) for the canvas path; unit tests
 * mock `CanvasTextMetrics` (there is no canvas under the node test env).
 */
export function measureWrappedText(
  text: string,
  options: MeasureTextOptions,
): MeasuredText {
  const wrap = options.wordWrapWidth !== undefined && options.wordWrapWidth > 0;
  const resolved =
    resolveTextStyle({
      fontSize: options.fontSize,
      ...(options.fontFamily !== undefined
        ? { fontFamily: options.fontFamily }
        : {}),
      ...(options.lineHeight !== undefined
        ? { lineHeight: options.lineHeight }
        : {}),
      wordWrap: wrap,
      ...(wrap ? { wordWrapWidth: options.wordWrapWidth } : {}),
    }) ?? {};
  // Bitmap text redirects `fontFamily` to a registered emphasis-variant atlas
  // (e.g. a defaultTextStyle `fontWeight` selecting the bold bake) — measure
  // through the same atlas the render path draws from.
  const style = applyMeasureStyle(
    options.bitmap ? (selectBitmapVariant(resolved) ?? resolved) : resolved,
  );
  if (options.bitmap) {
    // `getLayout` (what `measureText` delegates to, with `lines` in its type)
    // returns font base-measurement units; scale to px the same way pixi's own
    // `BitmapText.updateBounds` does.
    const m = BitmapFontManager.getLayout(text, style);
    return {
      width: m.width * m.scale,
      height: m.height * m.scale,
      lineCount: m.lines.length,
    };
  }
  const m = CanvasTextMetrics.measureText(text, style);
  return { width: m.width, height: m.height, lineCount: m.lines.length };
}

/** Slice a texture input into an array of frame textures. */
export function sliceTextureFrames(
  input: TextureInput,
  options: TextureSliceOptions,
): TextureResource[] {
  return sliceGrid(resolveTextureInput(input), options);
}
