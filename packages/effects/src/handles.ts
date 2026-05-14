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

/** Handle returned by `colorize`. */
export interface ColorizeHandle extends EffectHandle {
  /** Update the target colour at runtime. */
  setColor(color: number | string): void;
  /** Rebase the recolour ceiling; preserves the current intensity ratio. */
  setStrength(value: number): void;
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

/**
 * Handle returned by `godRay`. The animator self-schedules through the
 * engine's process scheduler — pauses with scene, time-scales with it.
 */
export interface GodRayHandle extends EffectHandle {
  setAngle(value: number): void;
  setGain(value: number): void;
}

/**
 * Handle returned by `shockwave`. `trigger(x, y)` arms a ripple from the
 * given local-space pixel coordinates and resolves itself through the
 * engine's process scheduler — overlapping triggers cancel the previous
 * ramp before starting the new one.
 */
export interface ShockwaveHandle extends EffectHandle {
  trigger(x?: number, y?: number): void;
}

/** Handle returned by `motionBlur`. */
export interface MotionBlurHandle extends EffectHandle {
  setVelocity(x: number, y: number): void;
}

/**
 * Handle returned by `oldFilm`. Like `crt`, the noise animator drives itself
 * through the engine's process scheduler — only the base `EffectHandle`
 * surface is exposed.
 */
export type OldFilmHandle = EffectHandle;

/** Handle returned by `bulgePinch`. */
export interface BulgePinchHandle extends EffectHandle {
  setStrength(value: number): void;
  setCenter(x: number, y: number): void;
  setRadius(value: number): void;
}

/** Handle returned by `halftone` (custom shader). */
export interface HalftoneHandle extends EffectHandle {
  setSize(value: number): void;
  setAngle(value: number): void;
  setAmount(value: number): void;
}

/**
 * Handle returned by `wave` (custom shader). The time uniform self-advances
 * through the engine's process scheduler — pauses with scene, time-scales
 * with it. `setSpeed` retunes the per-frame phase rate.
 */
export interface WaveHandle extends EffectHandle {
  setAmplitude(value: number): void;
  setWavelength(value: number): void;
  setSpeed(value: number): void;
}
