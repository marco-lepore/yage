import type { EffectHandle } from "@yagejs/renderer";

/**
 * Handle returned by `hitFlash`. `trigger()` arms a one-shot ramp; drive
 * it forward by calling `step(dt)` from your update loop so the flash
 * obeys `scene.timeScale` and `scene.paused`.
 */
export interface HitFlashHandle extends EffectHandle {
  /** Arm a one-shot flash. Cancels any in-flight trigger. */
  trigger(): void;
  /** Advance an in-flight trigger by `dt` ms. Call from your update loop. */
  step(dt: number): void;
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

/** Handle returned by `crt`. */
export interface CRTHandle extends EffectHandle {
  /** Animate the scanline noise — call from your update loop with `dt`. */
  step(dt: number): void;
}

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
