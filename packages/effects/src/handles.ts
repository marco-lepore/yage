import type { EffectHandle } from "@yagejs/renderer";

/**
 * Handle returned by `hitFlash`. `trigger()` arms a one-shot ramp that
 * drives itself through the engine's process scheduler — pauses with the
 * owning scene, time-scales with it, auto-cancels on `remove()`. No
 * caller-side `step(dt)` wiring required.
 */
export interface HitFlashHandle extends EffectHandle {
  /** Arm a one-shot flash. Cancels any in-flight trigger. */
  trigger(): void;
  /** Update the flash color at runtime. */
  setColor(color: number): void;
}

/** Handle returned by `bloom`. */
export interface BloomHandle extends EffectHandle {
  setThreshold(value: number): void;
  setBloomScale(value: number): void;
}

/** Handle returned by `outline`. */
export interface OutlineHandle extends EffectHandle {
  setThickness(value: number): void;
  setColor(color: number): void;
}

/** Handle returned by `dropShadow`. */
export interface DropShadowHandle extends EffectHandle {
  setOffset(x: number, y: number): void;
  setColor(color: number): void;
  setAlpha(value: number): void;
}

/** Handle returned by `pixelate`. */
export interface PixelateHandle extends EffectHandle {
  setSize(value: number): void;
}

/** Handle returned by `glow`. */
export interface GlowHandle extends EffectHandle {
  setOuterStrength(value: number): void;
  setInnerStrength(value: number): void;
  setColor(color: number): void;
}

/**
 * Handle returned by `crt`. The scanline noise animates itself through the
 * engine's process scheduler — no caller-side `step(dt)` required. The
 * handle exposes only the base `EffectHandle` surface
 * (`fadeIn`/`fadeOut`/`run`/`remove`/`setEnabled`).
 */
export type CRTHandle = EffectHandle;

/** Handle returned by `chromaticAberration`. */
export interface ChromaticAberrationHandle extends EffectHandle {
  setSeparation(value: number): void;
}

/** Handle returned by `vignette`. */
export interface VignetteHandle extends EffectHandle {
  setStrength(value: number): void;
}

/** Built-in color-grade presets. */
export type ColorGradePreset =
  | "neutral"
  | "sepia"
  | "grayscale"
  | "negative"
  | "night"
  | "warm"
  | "cool";

/** Handle returned by `colorGrade`. */
export interface ColorGradeHandle extends EffectHandle {
  setPreset(preset: ColorGradePreset): void;
}
