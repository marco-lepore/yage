/**
 * Shared UI theme — fonts, text presets, asset handles, and nine-slice configs.
 * Used across all UI examples like a design-system token file.
 */
import { texture } from "@yage/renderer";

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------
export const FONT_REGULAR = "Kenney Future";
export const FONT_NARROW = "Kenney Future Narrow";

const fontCSS = `
@font-face { font-family: "${FONT_REGULAR}"; src: url("/assets/Kenney Future.ttf"); }
@font-face { font-family: "${FONT_NARROW}"; src: url("/assets/Kenney Future Narrow.ttf"); }
`;
const styleEl = document.createElement("style");
styleEl.textContent = fontCSS;
document.head.appendChild(styleEl);

/** Call before engine.start() to ensure fonts are ready for PixiJS text measurement. */
export function loadFonts(): Promise<FontFace[]> {
  return Promise.all([
    document.fonts.load(`16px "${FONT_REGULAR}"`),
    document.fonts.load(`16px "${FONT_NARROW}"`),
  ]);
}

// ---------------------------------------------------------------------------
// Text style presets
// ---------------------------------------------------------------------------
export type TextPreset =
  | "title"
  | "subtitle"
  | "label"
  | "body"
  | "caption"
  | "button"
  | "buttonSmall"
  | "dark";

export function textStyle(
  preset: TextPreset,
  overrides?: Partial<{ fontSize: number; fill: number }>,
): Record<string, unknown> {
  const base = (() => {
    switch (preset) {
      case "title":       return { fontFamily: FONT_REGULAR, fontSize: 22, fill: 0xffffff };
      case "subtitle":    return { fontFamily: FONT_NARROW, fontSize: 13, fill: 0x64748b };
      case "label":       return { fontFamily: FONT_NARROW, fontSize: 13, fill: 0x94a3b8, fontWeight: "bold" as const };
      case "body":        return { fontFamily: FONT_NARROW, fontSize: 14, fill: 0xe2e8f0 };
      case "caption":     return { fontFamily: FONT_NARROW, fontSize: 11, fill: 0x94a3b8 };
      case "button":      return { fontFamily: FONT_NARROW, fontSize: 14, fill: 0xffffff };
      case "buttonSmall": return { fontFamily: FONT_NARROW, fontSize: 13, fill: 0xffffff };
      case "dark":        return { fontFamily: FONT_NARROW, fontSize: 13, fill: 0x333333 };
    }
  })();
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Asset handles — preloaded by each scene
// ---------------------------------------------------------------------------
export const assets = {
  panelBg:          texture("/assets/ui-sprites/panel-bg.png"),
  btnDefault:       texture("/assets/ui-sprites/btn-default.png"),
  btnHover:         texture("/assets/ui-sprites/btn-hover.png"),
  btnPressed:       texture("/assets/ui-sprites/btn-pressed.png"),
  btnDisabled:      texture("/assets/ui-sprites/btn-disabled.png"),
  sliderTrack:      texture("/assets/ui-sprites/slider-track.png"),
  sliderFillGreen:  texture("/assets/ui-sprites/slider-fill-green.png"),
  sliderFillBlue:   texture("/assets/ui-sprites/slider-fill-blue.png"),
  sliderHandle:     texture("/assets/ui-sprites/slider-handle.png"),
  checkboxChecked:  texture("/assets/ui-sprites/checkbox-checked.png"),
  checkboxUnchecked:texture("/assets/ui-sprites/checkbox-unchecked.png"),
  radioChecked:     texture("/assets/ui-sprites/radio-checked.png"),
  radioUnchecked:   texture("/assets/ui-sprites/radio-unchecked.png"),
  inputBg:          texture("/assets/ui-sprites/input-bg.png"),
  selectClosed:     texture("/assets/ui-sprites/select-closed.png"),
  selectOpen:       texture("/assets/ui-sprites/select-open.png"),
} as const;

/** All asset handles as an array — spread into scene.preload. */
export const allAssets = Object.values(assets);

// ---------------------------------------------------------------------------
// Sprite paths — @pixi/ui creates fresh Sprite instances from string paths
// ---------------------------------------------------------------------------
export const sprites = {
  btnDefault:       assets.btnDefault.path,
  btnHover:         assets.btnHover.path,
  btnPressed:       assets.btnPressed.path,
  btnDisabled:      assets.btnDisabled.path,
  sliderTrack:      assets.sliderTrack.path,
  sliderFillGreen:  assets.sliderFillGreen.path,
  sliderFillBlue:   assets.sliderFillBlue.path,
  sliderHandle:     assets.sliderHandle.path,
  checkboxChecked:  assets.checkboxChecked.path,
  checkboxUnchecked:assets.checkboxUnchecked.path,
  radioChecked:     assets.radioChecked.path,
  radioUnchecked:   assets.radioUnchecked.path,
  inputBg:          assets.inputBg.path,
} as const;

// ---------------------------------------------------------------------------
// Nine-slice insets
// ---------------------------------------------------------------------------
export const nineSlice = {
  button:  [10, 10, 10, 10] as [number, number, number, number],
  track:   [16, 4, 16, 4]   as [number, number, number, number],
  input:   [10, 10, 10, 10] as [number, number, number, number],
  panel:   10,
} as const;

// ---------------------------------------------------------------------------
// Button text offset (compensates for depth shadow)
// ---------------------------------------------------------------------------
export const btnTextOffset = { y: -4, pressed: { y: 0 } };

// ---------------------------------------------------------------------------
// Panel background presets
// ---------------------------------------------------------------------------
export const panelBg = {
  texture: assets.panelBg,
  mode: "nine-slice" as const,
  nineSlice: nineSlice.panel,
  tint: 0x334155,
};

/** Nine-slice button backgrounds for the custom UIButton component. */
export const nineSliceBtn = {
  background: {
    texture: assets.btnDefault,
    mode: "nine-slice" as const,
    nineSlice: nineSlice.button[0],
  },
  hoverBackground: {
    texture: assets.btnHover,
    mode: "nine-slice" as const,
    nineSlice: nineSlice.button[0],
  },
  pressBackground: {
    texture: assets.btnPressed,
    mode: "nine-slice" as const,
    nineSlice: nineSlice.button[0],
  },
};

/** Same as nineSliceBtn but keyed for the React <Button> component (bg/hoverBg/pressBg). */
export const nineSliceBtnReact = {
  bg: nineSliceBtn.background,
  hoverBg: nineSliceBtn.hoverBackground,
  pressBg: nineSliceBtn.pressBackground,
};
