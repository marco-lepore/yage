/**
 * DialogueTheme — the single flat visual-config object the dialogue factories
 * consume. A theme is a plain data object (no behaviour) so it can be authored
 * inline, imported from a preset module, or serialized.
 *
 * The factories ({@link createBoxDialogue}, {@link createBubbleDialogue},
 * {@link createMixedDialogue}) read every field below to construct the chrome /
 * text / choice presenters. {@link defaultTheme} returns a zero-asset instance
 * (Graphics chrome + canvas text, no `bitmapFont*`), so the factories work with
 * no caller-supplied theme.
 *
 * Bitmap fonts (`bitmapFont`) are an OPT-IN crisp-pixel path. Textured
 * nine-slice chrome is a separate opt-in re-theming path driven by the
 * {@link textured} field.
 */

import type { TextureInput } from "@yagejs/renderer";

/** Screen-space rectangle (pixels) for the dialogue box. */
export interface BoxRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DialogueTheme {
  /** Bottom-anchored box geometry on the virtual screen (screen-space px). */
  readonly box: BoxRect;
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
   * Optional textured-chrome styling (OPT-IN). NOT consumed yet: the planned
   * nine-slice branch in the Graphics chromes (Design C, D1) will render the
   * frame/bubble from these textures. The Graphics fields above remain the
   * fallback / default path.
   */
  readonly textured?: TexturedTheme;
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
 * TexturedTheme — opt-in texture fields for the nine-slice presenter variants.
 *
 * Most games use the default Graphics chrome. Provide a `frameTexture` +
 * `insets` to render the box frame as a stretchable nine-slice sprite, and
 * optionally a `bubbleTexture` for the speech bubble. Textures are referenced
 * by {@link TextureInput} (string key or Texture) so the theme stays
 * serializable.
 */
export interface TexturedTheme {
  /** Nine-slice texture for the box frame. */
  readonly frameTexture: TextureInput;
  /** Border insets for {@link frameTexture}, in source-texture pixels. */
  readonly insets: NineSliceInsets;
  /** Optional nine-slice texture for the speech bubble. */
  readonly bubbleTexture?: TextureInput;
  /** Border insets for {@link bubbleTexture}; defaults to {@link insets}. */
  readonly bubbleInsets?: NineSliceInsets;
}
