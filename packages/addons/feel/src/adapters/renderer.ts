import { easeInQuad, easeOutQuad, type EasingFunction } from "@yagejs/core";
import {
  colorize,
  dissolve,
  glitch,
  glow,
  hitFlash,
  outline,
  shockwave,
} from "@yagejs/effects";
import type {
  ColorizeOptions,
  DissolveHandle,
  DissolveOptions,
  GlitchHandle,
  GlitchOptions,
  GlowOptions,
  HitFlashHandle,
  HitFlashOptions,
  OutlineOptions,
  ShockwaveOptions,
  ShockwaveHandle,
} from "@yagejs/effects";
import type {
  CameraComponent,
  CameraEntity,
  CameraModifierHandle,
  EffectFactory,
  EffectHandle,
  EffectsHost,
  VisualComponent,
  VisualOpacityModifierHandle,
  VisualVisibilityModifierHandle,
} from "@yagejs/renderer";
import { defineFeelEffect } from "../core/node.js";
import type { FeelEffectContext, FeelNode } from "../core/types.js";
import { feelPunchAmount, validateFeelPeakAt } from "../internal/envelope.js";
import type { FeelVisualTarget } from "./visual.js";

type FeelCamera = CameraEntity | CameraComponent;
type FeelCameraTarget =
  | FeelCamera
  | ((context: FeelEffectContext) => FeelCamera);

export type FeelEffectsHostTarget =
  | EffectsHost
  | ((context: FeelEffectContext) => EffectsHost);

export interface FeelCameraShakeOptions {
  camera: FeelCameraTarget;
  /** Shake amplitude in pixels. Default: 6. */
  intensity?: number;
  /** Duration in seconds. Default: 0.18. */
  duration?: number;
  /** Oscillations per second. Default: 28. */
  frequency?: number;
  /** Exponent applied to the fade to zero. Default: 1. */
  decay?: number;
}

/** Shake a camera through an independently removable modifier. */
export function feelCameraShake(options: FeelCameraShakeOptions): FeelNode {
  const duration = options.duration ?? 0.18;
  const frequency = options.frequency ?? 28;
  const decay = options.decay ?? 1;
  return defineFeelEffect(duration, (context) => {
    const camera = resolveCamera(options.camera, context);
    const phaseX = context.random.range(0, Math.PI * 2);
    const phaseY = context.random.range(0, Math.PI * 2);
    let modifier: CameraModifierHandle | undefined;
    return {
      start: () => {
        modifier = camera.modifiers.add();
      },
      update: (progress) => {
        const elapsed = progress * duration;
        const envelope = Math.pow(Math.max(0, 1 - progress), decay);
        const amplitude =
          (options.intensity ?? 6) * envelope * context.intensity;
        modifier?.setPosition({
          x: Math.sin(elapsed * frequency * Math.PI * 2 + phaseX) * amplitude,
          y: Math.sin(elapsed * frequency * Math.PI * 2 + phaseY) * amplitude,
        });
      },
      finish: () => modifier?.remove(),
    };
  });
}

export interface FeelCameraZoomOptions {
  camera: FeelCameraTarget;
  /** Peak zoom multiplier. Default: 1.08. */
  scale?: number;
  duration?: number;
  peakAt?: number;
  attackEasing?: EasingFunction;
  releaseEasing?: EasingFunction;
}

/** Pulse camera zoom without replacing follow or other live camera state. */
export function feelCameraZoom(options: FeelCameraZoomOptions): FeelNode {
  const duration = options.duration ?? 0.2;
  validateFeelPeakAt(options.peakAt);
  return defineFeelEffect(duration, (context) => {
    const camera = resolveCamera(options.camera, context);
    let modifier: CameraModifierHandle | undefined;
    return {
      start: () => {
        modifier = camera.modifiers.add();
      },
      update: (progress) => {
        const amount = feelPunchAmount(
          progress,
          options.peakAt,
          options.attackEasing,
          options.releaseEasing,
        );
        modifier?.setZoom(
          Math.max(
            0.0001,
            1 + ((options.scale ?? 1.08) - 1) * amount * context.intensity,
          ),
        );
      },
      finish: () => modifier?.remove(),
    };
  });
}

export interface FeelCameraRotationOptions {
  camera: FeelCameraTarget;
  /** Peak additive camera angle in radians. Default: `0.04`. */
  radians?: number;
  /** Total duration in seconds. Default: `0.25`. */
  duration?: number;
  peakAt?: number;
  attackEasing?: EasingFunction;
  releaseEasing?: EasingFunction;
}

/** Pulse camera rotation without replacing follow or other camera state. */
export function feelCameraRotation(
  options: FeelCameraRotationOptions,
): FeelNode {
  const duration = options.duration ?? 0.25;
  validateFeelPeakAt(options.peakAt);
  return defineFeelEffect(duration, (context) => {
    const camera = resolveCamera(options.camera, context);
    let modifier: CameraModifierHandle | undefined;
    return {
      start: () => {
        modifier = camera.modifiers.add();
      },
      update: (progress) => {
        modifier?.setRotation(
          (options.radians ?? 0.04) *
            feelPunchAmount(
              progress,
              options.peakAt,
              options.attackEasing,
              options.releaseEasing,
            ) *
            context.intensity,
        );
      },
      finish: () => modifier?.remove(),
    };
  });
}

export interface FeelEffectOptions {
  /** Total pulse duration. Default: 0.2. */
  duration?: number;
  peakAt?: number;
  attackEasing?: EasingFunction;
  releaseEasing?: EasingFunction;
}

export interface FeelGlitchOptions extends GlitchOptions, FeelEffectOptions {
  host: FeelEffectsHostTarget;
  /** Pattern changes per second. Default: 24. */
  refreshRate?: number;
  /** Normalized time when the held glitch begins to release. Default: `0.72`. */
  releaseAt?: number;
}

export interface FeelDissolveOptions extends DissolveOptions {
  target: FeelVisualTarget;
  /** Time to move from intact to transparent. Default: `0.6`. */
  duration?: number;
  /** Progress easing. Default: `easeInQuad`. */
  easing?: EasingFunction;
}

/** Advance a dissolve from intact to transparent, then remove its filter. */
export function feelDissolve(options: FeelDissolveOptions): FeelNode {
  const duration = options.duration ?? 0.6;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`feelDissolve: duration must be a finite number > 0.`);
  }
  const { target, easing } = options;
  const effectOptions: DissolveOptions = {
    ...(options.edgeColor === undefined
      ? {}
      : { edgeColor: options.edgeColor }),
    ...(options.edgeWidth === undefined
      ? {}
      : { edgeWidth: options.edgeWidth }),
    ...(options.noiseScale === undefined
      ? {}
      : { noiseScale: options.noiseScale }),
    ...(options.softness === undefined ? {} : { softness: options.softness }),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  };
  return defineFeelEffect(duration, (context) => {
    const visual = resolveVisual(target, context);
    let handle: DissolveHandle | undefined;
    return {
      start: () => {
        context.invoke("effect factory", () => {
          handle = visual.fx.addEffect(dissolve(effectOptions));
        });
        handle?.setIntensity(0);
      },
      update: (progress) => {
        let eased = easeInQuad(progress);
        if (easing) {
          context.invoke("dissolve easing", () => {
            const value = easing(progress);
            if (!Number.isFinite(value)) {
              throw new Error(
                `feelDissolve: easing must return a finite number, got ${value}.`,
              );
            }
            eased = value;
          });
        }
        handle?.setIntensity(
          Math.min(1, Math.max(0, eased) * context.intensity),
        );
      },
      finish: () => handle?.remove(),
    };
  });
}

/** Pulse a glitch and refresh its bands from the cue's seeded random source. */
export function feelGlitch(options: FeelGlitchOptions): FeelNode {
  const duration = options.duration ?? 0.25;
  const refreshRate = options.refreshRate ?? 24;
  if (!Number.isFinite(refreshRate) || refreshRate <= 0) {
    throw new Error(`feelGlitch: refreshRate must be a finite number > 0.`);
  }
  const peakAt = options.peakAt ?? 0.08;
  const releaseAt = options.releaseAt ?? Math.max(0.72, peakAt);
  validateFeelPeakAt(peakAt);
  if (!Number.isFinite(releaseAt) || releaseAt < 0 || releaseAt > 1) {
    throw new Error(`feelGlitch: releaseAt must be between 0 and 1.`);
  }
  if (releaseAt < peakAt) {
    throw new Error(
      `feelGlitch: releaseAt must be greater than or equal to peakAt.`,
    );
  }
  const { host, attackEasing, releaseEasing } = options;
  const effectOptions: GlitchOptions = {
    ...(options.slices === undefined ? {} : { slices: options.slices }),
    ...(options.offset === undefined ? {} : { offset: options.offset }),
    ...(options.direction === undefined
      ? {}
      : { direction: options.direction }),
    ...(options.fillMode === undefined ? {} : { fillMode: options.fillMode }),
    ...(options.average === undefined ? {} : { average: options.average }),
    ...(options.minSize === undefined ? {} : { minSize: options.minSize }),
    ...(options.sampleSize === undefined
      ? {}
      : { sampleSize: options.sampleSize }),
    ...(options.red === undefined ? {} : { red: options.red }),
    ...(options.green === undefined ? {} : { green: options.green }),
    ...(options.blue === undefined ? {} : { blue: options.blue }),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  };
  return defineFeelEffect(duration, (context) => {
    const resolvedHost = resolveCallback(host, context, "effect host source");
    let handle: GlitchHandle | undefined;
    let refreshElapsed = 0;
    const refresh = (seed?: number): void => {
      handle?.refresh(seed ?? context.random.int(0, 0xffffffff));
    };
    return {
      start: () => {
        context.invoke("effect factory", () => {
          handle = resolvedHost.addEffect(glitch(effectOptions));
        });
        handle?.setIntensity(0);
        refresh(options.seed);
      },
      update: (progress, dt) => {
        // Drain every whole interval the frame covered. Refreshing once and
        // dropping the remainder would undershoot `refreshRate` on long
        // frames and make the same elapsed time consume a different number
        // of seeded values depending on frame cadence.
        refreshElapsed += dt;
        const interval = 1 / refreshRate;
        while (refreshElapsed >= interval) {
          refreshElapsed -= interval;
          refresh();
        }
        handle?.setIntensity(
          glitchPresenceAmount(
            progress,
            peakAt,
            releaseAt,
            attackEasing,
            releaseEasing,
          ) * context.intensity,
        );
      },
      finish: () => handle?.remove(),
    };
  });
}

function glitchPresenceAmount(
  progress: number,
  peakAt: number,
  releaseAt: number,
  attack: EasingFunction = easeOutQuad,
  release: EasingFunction = easeInQuad,
): number {
  if (peakAt > 0 && progress < peakAt) return attack(progress / peakAt);
  if (progress <= releaseAt || releaseAt >= 1) return 1;
  return 1 - release((progress - releaseAt) / (1 - releaseAt));
}

/** Attach any YAGE effect, pulse its primary intensity, then remove it. */
export function feelEffect<H extends EffectHandle>(
  host: EffectsHost,
  factory: EffectFactory<H>,
  options: FeelEffectOptions = {},
): FeelNode {
  const duration = options.duration ?? 0.2;
  validateFeelPeakAt(options.peakAt);
  return defineFeelEffect(duration, (context) => {
    let handle: H | undefined;
    return {
      start: () => {
        context.invoke("effect factory", () => {
          handle = host.addEffect(factory);
        });
        handle?.setIntensity(0);
      },
      update: (progress) => {
        handle?.setIntensity(
          feelPunchAmount(
            progress,
            options.peakAt,
            options.attackEasing,
            options.releaseEasing,
          ) * context.intensity,
        );
      },
      finish: () => handle?.remove(),
    };
  });
}

export interface FeelOutlineOptions extends OutlineOptions, FeelEffectOptions {
  target: FeelVisualTarget;
}

/** Pulse an animated hard-edge outline around a visual component. */
export function feelOutline(options: FeelOutlineOptions): FeelNode {
  const {
    target,
    duration,
    peakAt,
    attackEasing,
    releaseEasing,
    ...effectOptions
  } = options;
  return feelVisualEffect(target, outline(effectOptions), {
    ...(duration === undefined ? {} : { duration }),
    ...(peakAt === undefined ? {} : { peakAt }),
    ...(attackEasing === undefined ? {} : { attackEasing }),
    ...(releaseEasing === undefined ? {} : { releaseEasing }),
  });
}

export interface FeelGlowOptions extends GlowOptions, FeelEffectOptions {
  target: FeelVisualTarget;
}

/** Pulse an animated inner or outer glow around a visual component. */
export function feelGlow(options: FeelGlowOptions): FeelNode {
  const {
    target,
    duration,
    peakAt,
    attackEasing,
    releaseEasing,
    ...effectOptions
  } = options;
  return feelVisualEffect(target, glow(effectOptions), {
    ...(duration === undefined ? {} : { duration }),
    ...(peakAt === undefined ? {} : { peakAt }),
    ...(attackEasing === undefined ? {} : { attackEasing }),
    ...(releaseEasing === undefined ? {} : { releaseEasing }),
  });
}

export interface FeelColorizeOptions
  extends ColorizeOptions, FeelEffectOptions {
  target: FeelVisualTarget;
}

/** Pulse a replace-style color treatment over a visual component. */
export function feelColorize(options: FeelColorizeOptions): FeelNode {
  const {
    target,
    duration,
    peakAt,
    attackEasing,
    releaseEasing,
    ...effectOptions
  } = options;
  return feelVisualEffect(target, colorize(effectOptions), {
    ...(duration === undefined ? {} : { duration }),
    ...(peakAt === undefined ? {} : { peakAt }),
    ...(attackEasing === undefined ? {} : { attackEasing }),
    ...(releaseEasing === undefined ? {} : { releaseEasing }),
  });
}

/** Attach and trigger the built-in hit flash, then remove it. */
export function feelHitFlash(
  host: EffectsHost,
  options: HitFlashOptions = {},
): FeelNode {
  const duration = options.duration ?? 0.12;
  return defineFeelEffect(duration, (context) => {
    let handle: HitFlashHandle | undefined;
    return {
      start: () => {
        const configured: HitFlashOptions = {
          ...options,
          peak: (options.peak ?? 1) * context.intensity,
        };
        handle = host.addEffect(hitFlash(configured));
        handle.trigger();
      },
      finish: () => handle?.remove(),
    };
  });
}

export interface FeelShockwaveOptions extends ShockwaveOptions {
  /** Trigger center in the effect host's local coordinates. */
  center?:
    | { x: number; y: number }
    | ((context: FeelEffectContext) => { x: number; y: number });
}

/** Attach and trigger the built-in shockwave, then remove it. */
export function feelShockwave(
  host: EffectsHost,
  options: FeelShockwaveOptions = {},
): FeelNode {
  const duration = options.duration ?? 1;
  return defineFeelEffect(duration, (context) => {
    let handle: ShockwaveHandle | undefined;
    return {
      start: () => {
        const center = resolveCallback(
          options.center,
          context,
          "shockwave center source",
        );
        handle = host.addEffect(
          shockwave({
            ...options,
            amplitude: (options.amplitude ?? 30) * context.intensity,
          }),
        );
        handle.trigger(center?.x, center?.y);
      },
      finish: () => handle?.remove(),
    };
  });
}

export interface FeelOpacityOptions {
  target: FeelVisualTarget;
  /** Peak alpha multiplier. Default: 0.25. */
  alpha?: number;
  duration?: number;
  peakAt?: number;
}

/** Pulse a visual component's opacity and restore its live alpha. */
export function feelOpacity(options: FeelOpacityOptions): FeelNode {
  const duration = options.duration ?? 0.18;
  validateFeelPeakAt(options.peakAt);
  return defineFeelEffect(duration, (context) => {
    const target = resolveVisual(options.target, context);
    let modifier: VisualOpacityModifierHandle | undefined;
    return {
      start: () => {
        modifier = target.modifiers.addOpacity();
      },
      update: (progress) => {
        const amount = feelPunchAmount(progress, options.peakAt);
        modifier?.setFactor(
          Math.max(
            0,
            1 + ((options.alpha ?? 0.25) - 1) * amount * context.intensity,
          ),
        );
      },
      finish: () => modifier?.remove(),
    };
  });
}

export interface FeelBlinkOptions {
  target: FeelVisualTarget;
  /** Total duration. Default: 0.3. */
  duration?: number;
  /** Seconds per visibility state. Default: 0.05. */
  interval?: number;
}

/** Toggle visibility for a short window, then restore it. */
export function feelBlink(options: FeelBlinkOptions): FeelNode {
  const duration = options.duration ?? 0.3;
  const interval = options.interval ?? 0.05;
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new Error(`feelBlink: interval must be a finite number > 0.`);
  }
  return defineFeelEffect(duration, (context) => {
    const target = resolveVisual(options.target, context);
    let modifier: VisualVisibilityModifierHandle | undefined;
    return {
      start: () => {
        modifier = target.modifiers.addVisibility();
      },
      update: (progress) => {
        modifier?.setVisible(
          Math.floor((progress * duration) / interval) % 2 !== 0,
        );
      },
      finish: () => modifier?.remove(),
    };
  });
}

function resolveCamera(
  camera: FeelCameraTarget,
  context: FeelEffectContext,
): FeelCamera {
  return resolveCallback(camera, context, "camera target source");
}

function resolveVisual(
  target: FeelVisualTarget,
  context: FeelEffectContext,
): VisualComponent {
  return resolveCallback(target, context, "visual target source");
}

function feelVisualEffect<H extends EffectHandle>(
  target: FeelVisualTarget,
  factory: EffectFactory<H>,
  options: FeelEffectOptions,
): FeelNode {
  const duration = options.duration ?? 0.2;
  validateFeelPeakAt(options.peakAt);
  return defineFeelEffect(duration, (context) => {
    const visual = resolveVisual(target, context);
    let handle: H | undefined;
    return {
      start: () => {
        handle = visual.fx.addEffect(factory);
        handle.setIntensity(0);
      },
      update: (progress) => {
        handle?.setIntensity(
          feelPunchAmount(
            progress,
            options.peakAt,
            options.attackEasing,
            options.releaseEasing,
          ) * context.intensity,
        );
      },
      finish: () => handle?.remove(),
    };
  });
}

function resolveCallback<T>(
  source: T | ((context: FeelEffectContext) => T),
  context: FeelEffectContext,
  label: string,
): T;
function resolveCallback<T>(
  source: T | ((context: FeelEffectContext) => T) | undefined,
  context: FeelEffectContext,
  label: string,
): T | undefined;
function resolveCallback<T>(
  source: T | ((context: FeelEffectContext) => T) | undefined,
  context: FeelEffectContext,
  label: string,
): T | undefined {
  if (typeof source !== "function") return source;
  let value: T | undefined;
  context.invoke(label, () => {
    value = (source as (context: FeelEffectContext) => T)(context);
  });
  return value;
}
