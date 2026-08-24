import type { EasingFunction } from "@yagejs/core";
import { hitFlash, shockwave } from "@yagejs/effects";
import type {
  HitFlashHandle,
  HitFlashOptions,
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
import { feelPunchAmount } from "../internal/envelope.js";

type FeelCamera = CameraEntity | CameraComponent;
type FeelCameraTarget =
  | FeelCamera
  | ((context: FeelEffectContext) => FeelCamera);

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

export interface FeelEffectOptions {
  /** Total pulse duration. Default: 0.2. */
  duration?: number;
  peakAt?: number;
  attackEasing?: EasingFunction;
  releaseEasing?: EasingFunction;
}

/** Attach any YAGE effect, pulse its primary intensity, then remove it. */
export function feelEffect<H extends EffectHandle>(
  host: EffectsHost,
  factory: EffectFactory<H>,
  options: FeelEffectOptions = {},
): FeelNode {
  const duration = options.duration ?? 0.2;
  return defineFeelEffect(duration, (context) => {
    let handle: H | undefined;
    return {
      start: () => {
        handle = host.addEffect(factory);
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
        handle = host.addEffect(
          shockwave({
            ...options,
            amplitude: (options.amplitude ?? 30) * context.intensity,
          }),
        );
        const center =
          typeof options.center === "function"
            ? options.center(context)
            : options.center;
        handle.trigger(center?.x, center?.y);
      },
      finish: () => handle?.remove(),
    };
  });
}

export interface FeelOpacityOptions {
  target: VisualComponent | ((context: FeelEffectContext) => VisualComponent);
  /** Peak alpha multiplier. Default: 0.25. */
  alpha?: number;
  duration?: number;
  peakAt?: number;
}

/** Pulse a visual component's opacity and restore its live alpha. */
export function feelOpacity(options: FeelOpacityOptions): FeelNode {
  const duration = options.duration ?? 0.18;
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
  target: VisualComponent | ((context: FeelEffectContext) => VisualComponent);
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
  return typeof camera === "function" ? camera(context) : camera;
}

function resolveVisual(
  target: VisualComponent | ((context: FeelEffectContext) => VisualComponent),
  context: FeelEffectContext,
): VisualComponent {
  return typeof target === "function" ? target(context) : target;
}
