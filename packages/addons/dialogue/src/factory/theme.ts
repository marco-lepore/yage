/**
 * DialogueTheme — the single flat visual-config object the dialogue factories
 * consume. A theme is a plain data object (no behaviour) so it can be authored
 * inline, imported from a preset module, or serialized.
 *
 * The factories ({@link createBoxDialogue}, {@link createBubbleDialogue},
 * {@link createMixedDialogue}) map every field below onto the chrome / text /
 * choice presenter configs. The mapping is mechanical: a presenter-config field
 * has the SAME name as the theme field it comes from (e.g. theme `frameColor` →
 * config `frameColor`), so drift is visible and a `dialogue.exhaustiveness`
 * test asserts every field reaches a presenter.
 *
 * {@link defaultTheme} returns a zero-asset instance (Graphics chrome + canvas
 * text, no `bitmapFont`/`textured`), so the factories work with no
 * caller-supplied theme.
 *
 * Bitmap fonts (`bitmapFont`) are an OPT-IN crisp-pixel path. Textured
 * nine-slice chrome is a separate opt-in re-theming path driven by the
 * {@link textured} field.
 */

import type { TextureInput } from "@yagejs/renderer";

/**
 * Viewport-relative bounds for the dialogue box (virtual px). The box is a
 * full-width bottom bar resolved against the renderer's design size at mount, so
 * the default presenter works at ANY virtual resolution with no override: the
 * width is `viewport.width - 2*marginX`, and the frame anchors `marginY` from the
 * screen edge. `meta.position` reuses these: `bottom` (default) anchors at the
 * bottom edge, `top` mirrors `marginY` to the top, `center` ignores it.
 */
export interface BoxBounds {
  /** Horizontal margin from the left and right screen edges (virtual px). */
  readonly marginX: number;
  /** Vertical margin from the anchored screen edge — the bottom by default, the
   *  top for `meta.position: top` (the centred position ignores it). */
  readonly marginY: number;
  /** Box height (virtual px) — sized to hold the body text, not the screen, so
   *  it holds the same number of lines at any resolution. */
  readonly height: number;
}

/** Continue-caret styling. The caret is the blinking "press to advance"
 *  triangle every chrome draws at its bottom-right; both fields are optional —
 *  omit them for the built-in defaults ({@link DEFAULT_CARET_BLINK_MS} /
 *  {@link DEFAULT_CARET_SIZE}). The nested-group shape is the convention the
 *  (cut) glossary `term` styling returns into. */
export interface CaretTheme {
  /** Blink time constant (ms) in `0.35 + 0.65·(0.5 + 0.5·sin(t/blinkMs))`.
   *  Larger = slower pulse. Default {@link DEFAULT_CARET_BLINK_MS}. */
  readonly blinkMs?: number;
  /** Triangle size (px). Default {@link DEFAULT_CARET_SIZE} (7×5, pointing down). */
  readonly size?: { readonly width: number; readonly height: number };
}

export interface DialogueTheme {
  /** Box geometry as viewport-relative margins + height — a full-width bottom
   *  bar resolved against the renderer's design size, so it works at any
   *  resolution with no override. See {@link BoxBounds}. */
  readonly box: BoxBounds;
  /** Inner padding between the frame and its contents. */
  readonly padding: number;

  // --- Frame / bubble background ---
  readonly frameColor: number;
  readonly frameAlpha: number;
  readonly borderColor: number;
  readonly cornerRadius: number;

  // --- Name plate + continue caret ---
  readonly nameColor: number;
  readonly nameSize: number;
  /** Blinking "continue" caret colour. */
  readonly indicatorColor: number;
  /** Continue-caret blink + size (optional; built-in defaults otherwise). */
  readonly caret?: CaretTheme;

  // --- Body text ---
  readonly textSize: number;
  readonly lineHeight: number;
  readonly textColor: number;
  /** Base reveal rate (characters/second). */
  readonly charsPerSec: number;

  // --- Choices ---
  readonly choiceSize: number;
  readonly choiceColor: number;
  readonly choiceSelectedColor: number;
  readonly highlightColor: number;
  /** Vertical gap (px) between choice rows. One value for box and bubble lists
   *  (a per-bundle override stays possible via the presenter config). Optional;
   *  default {@link DEFAULT_CHOICE_GAP}. */
  readonly choiceGap?: number;

  // --- Speech bubble ---
  /** Bubble tail tip offset from the speaker anchor (px), the little
   *  asymmetric "lean" of the pointer. Optional; default {@link DEFAULT_TAIL_LEAN}.
   *  Bubble *size* (min/max width, height, tail height) is geometry, set via
   *  `createBubbleDialogue`'s `bubble` option, not the theme. */
  readonly tailLean?: { readonly x: number; readonly y: number };

  // --- Fonts (omit the bitmap field for canvas text) ---
  /**
   * Baked bitmap-font name (OPT-IN). Omit for canvas text. When set, the
   * presenters render with the crisp pixel atlas instead of canvas SplitText.
   * Bold/italic are synthesised on the regular atlas (skew + double-draw);
   * variant-atlas fields will return if a baseline-compensating crisp path
   * lands in the renderer.
   */
  readonly bitmapFont?: string;
  /** Canvas font family (used when {@link bitmapFont} is omitted). */
  readonly fontFamily?: string;
  /** Canvas render resolution (used when not bitmap). */
  readonly resolution?: number;

  // --- Render layers (screen-space) ---
  /** Layer for the frame + selection highlight + continue caret. */
  readonly layerFrame: string;
  /** Layer for all text (name, body, choice labels). */
  readonly layerText: string;

  // --- Behaviour ---
  /** Hold-to-fast-forward multiplier. Default 4 (applied by the session). */
  readonly skipMultiplier?: number;

  /**
   * Optional textured nine-slice chrome (OPT-IN) — a MAP of named
   * {@link ChromeStyle}s. A box line picks one by name through its
   * `meta.chrome` key; the box chrome renders that style's `frame` as a
   * stretchable nine-slice instead of the drawn rounded rect, and the bubble
   * renders the `"default"` style's `bubble` (if any). Two style names are
   * reserved:
   *   - `"default"` — the look used for box lines with no (or an unknown)
   *     `meta.chrome`. Omit it to keep the drawn Graphics frame as the default.
   *   - `"none"` — built-in (needs no entry); hides the box frame entirely for
   *     that line (e.g. a full-bleed narration line).
   *
   * Leave `textured` undefined for the Graphics-only default path.
   */
  readonly textured?: Readonly<Record<string, ChromeStyle>>;
}

/**
 * NineSliceInsets — the four immutable border widths (in source-texture pixels)
 * that define a nine-slice frame. The center + edges stretch; the corners stay
 * fixed. Matches Pixi's NineSliceSprite `leftWidth`/`topHeight`/etc.
 */
export interface NineSliceInsets {
  /** Fixed-width left border in texture pixels. */
  readonly left: number;
  /** Fixed-height top border in texture pixels. */
  readonly top: number;
  /** Fixed-width right border in texture pixels. */
  readonly right: number;
  /** Fixed-height bottom border in texture pixels. */
  readonly bottom: number;
}

/**
 * A single nine-slice texture frame: the source texture plus its border insets.
 * Textures are referenced by {@link TextureInput} (string key or Texture) so the
 * theme stays serializable. Used for both box frames and speech bubbles.
 */
export interface NineSliceFrame {
  /** Nine-slice texture (string asset key or a resolved Texture). */
  readonly texture: TextureInput;
  /** Border insets for {@link texture}, in source-texture pixels. */
  readonly insets: NineSliceInsets;
}

/**
 * A named chrome style: a box-frame nine-slice and, optionally, a matching
 * speech-bubble nine-slice. A box line selects a style by name via its
 * `meta.chrome` key (see {@link DialogueTheme.textured}); the speech bubble uses
 * the `"default"` style's `bubble` for every bubble line (per-line bubble
 * variants are not a thing — bubbles are diegetic, anchored to an actor).
 */
export interface ChromeStyle {
  /** Box-frame nine-slice for this style. */
  readonly frame: NineSliceFrame;
  /** Speech-bubble nine-slice (only the `"default"` style's `bubble` is read).
   *  Omit to keep the drawn Graphics bubble. */
  readonly bubble?: NineSliceFrame;
}

/** Default continue-caret blink time constant (ms). */
export const DEFAULT_CARET_BLINK_MS = 260;
/** Default continue-caret triangle size (px), pointing down. */
export const DEFAULT_CARET_SIZE: { readonly width: number; readonly height: number } = {
  width: 7,
  height: 5,
};
/** Default vertical gap (px) between choice rows (box + bubble). */
export const DEFAULT_CHOICE_GAP = 6;
/** Default bubble tail tip offset from the speaker anchor (px). */
export const DEFAULT_TAIL_LEAN: { readonly x: number; readonly y: number } = { x: -3, y: -2 };

/** Reserved `meta.chrome` / {@link DialogueTheme.textured} key: the box look
 *  used when a line carries no (or an unknown) `meta.chrome`. */
export const CHROME_STYLE_DEFAULT = "default";
/** Reserved `meta.chrome` value (built-in, needs no `textured` entry): hide the
 *  box frame for that line. */
export const CHROME_STYLE_NONE = "none";

/** The box-frame nine-slice for each named style, shaped for the box chrome
 *  config (`meta.chrome` → frame). Undefined when the theme has no `textured`. */
export function boxFrameStyles(
  textured: DialogueTheme["textured"],
): Readonly<Record<string, NineSliceFrame>> | undefined {
  if (!textured) return undefined;
  const out: Record<string, NineSliceFrame> = {};
  for (const [name, style] of Object.entries(textured)) out[name] = style.frame;
  return out;
}

/** The speech-bubble nine-slice from the `"default"` style, for the bubble
 *  chrome config. Undefined when there is no textured `"default"` bubble. */
export function defaultBubbleFrame(textured: DialogueTheme["textured"]): NineSliceFrame | undefined {
  return textured?.[CHROME_STYLE_DEFAULT]?.bubble;
}
