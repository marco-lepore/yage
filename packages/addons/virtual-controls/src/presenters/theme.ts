import { VIRTUAL_CONTROLS_LAYER } from "./layers.js";

/**
 * Flat styling knobs for the built-in Graphics presenter. Zero assets — pure
 * Graphics fills/strokes + canvas text, legible over arbitrary game art.
 * All colors are 0xRRGGBB; alphas 0..1; scales are fractions of the control
 * radius so the theme works at every control size.
 */
export interface ControlsTheme {
  /** Screen-space render layer (auto-provisioned at mount). */
  readonly layer: string;

  readonly stickBaseColor: number;
  readonly stickBaseAlpha: number;
  readonly stickBorderColor: number;
  readonly stickBorderAlpha: number;
  readonly stickBorderWidth: number;
  readonly stickKnobColor: number;
  readonly stickKnobAlpha: number;
  /** Knob radius as a fraction of the stick radius. */
  readonly knobScale: number;

  readonly buttonColor: number;
  readonly buttonAlpha: number;
  readonly buttonBorderColor: number;
  readonly buttonBorderAlpha: number;
  readonly buttonBorderWidth: number;
  readonly buttonPressedColor: number;
  readonly buttonPressedAlpha: number;

  readonly labelColor: number;
  readonly labelAlpha: number;
  /** Label font size as a fraction of the button radius. */
  readonly labelScale: number;
  readonly fontFamily: string;

  /** Alpha multiplier on an idle (untouched) control. */
  readonly idleAlpha: number;
  /** Alpha multiplier while engaged/pressed. */
  readonly activeAlpha: number;
}

/**
 * The zero-config theme: translucent dark discs with light rims that read on
 * both bright and dark scenes. Returns a fresh object each call — spread and
 * tweak freely:
 *
 * ```ts
 * createControlsPresenter({ buttonPressedColor: 0xf472b6 });
 * ```
 */
export function defaultControlsTheme(): ControlsTheme {
  return {
    layer: VIRTUAL_CONTROLS_LAYER.name,

    stickBaseColor: 0x0b1020,
    stickBaseAlpha: 0.38,
    stickBorderColor: 0xf8fafc,
    stickBorderAlpha: 0.5,
    stickBorderWidth: 2,
    stickKnobColor: 0xf8fafc,
    stickKnobAlpha: 0.85,
    knobScale: 0.42,

    buttonColor: 0x0b1020,
    buttonAlpha: 0.38,
    buttonBorderColor: 0xf8fafc,
    buttonBorderAlpha: 0.5,
    buttonBorderWidth: 2,
    buttonPressedColor: 0x38bdf8,
    buttonPressedAlpha: 0.7,

    labelColor: 0xf8fafc,
    labelAlpha: 0.9,
    labelScale: 0.7,
    fontFamily: "system-ui, sans-serif",

    idleAlpha: 0.6,
    activeAlpha: 1,
  };
}
