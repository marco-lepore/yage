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
  CameraShakeOptions,
  EffectFactory,
  EffectHandle,
  EffectsHost,
  VisualComponent,
} from "@yagejs/renderer";
import { defineFeelEffect } from "../core/node.js";
import type { FeelEffectContext, FeelNode } from "../core/types.js";
import { feelPunchAmount } from "../internal/envelope.js";
import {
  addBooleanContribution,
  type BooleanContributionHandle,
} from "../internal/booleanMixer.js";
import {
  addNumberContribution,
  type NumberContributionHandle,
} from "../internal/numberMixer.js";

type FeelCamera = CameraEntity | CameraComponent;
type FeelCameraTarget =
  | FeelCamera
  | ((context: FeelEffectContext) => FeelCamera);

export interface FeelCameraShakeOptions extends CameraShakeOptions {
  camera: FeelCameraTarget;
  /** Shake amplitude in pixels. Default: 6. */
  intensity?: number;
  /** Duration in seconds. Default: 0.18. */
  duration?: number;
}

/** Start YAGE's additive camera shake. */
export function feelCameraShake(options: FeelCameraShakeOptions): FeelNode {
  return defineFeelEffect(0, (context) => ({
    start: () => {
      const camera = resolveCamera(options.camera, context);
      camera.shake(
        (options.intensity ?? 6) * context.intensity,
        options.duration ?? 0.18,
        options.decay !== undefined ? { decay: options.decay } : undefined,
      );
    },
  }));
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
    let contribution: NumberContributionHandle | undefined;
    return {
      start: () => {
        contribution = addNumberContribution(
          camera,
          "camera.zoom",
          "multiply",
          () => camera.zoom,
          (value) => {
            camera.zoom = value;
          },
        );
      },
      update: (progress) => {
        const amount = feelPunchAmount(
          progress,
          options.peakAt,
          options.attackEasing,
          options.releaseEasing,
        );
        contribution?.set(
          1 + ((options.scale ?? 1.08) - 1) * amount * context.intensity,
        );
      },
      finish: () => contribution?.remove(),
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
    let contribution: NumberContributionHandle | undefined;
    return {
      start: () => {
        contribution = addNumberContribution(
          target,
          "visual.alpha",
          "multiply",
          () => target.alpha,
          (value) => {
            target.alpha = value;
          },
        );
      },
      update: (progress) => {
        const amount = feelPunchAmount(progress, options.peakAt);
        contribution?.set(
          Math.max(
            0,
            1 + ((options.alpha ?? 0.25) - 1) * amount * context.intensity,
          ),
        );
      },
      finish: () => contribution?.remove(),
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
    let contribution: BooleanContributionHandle | undefined;
    return {
      start: () => {
        contribution = addBooleanContribution(
          target,
          "visual.visible",
          () => target.visible,
          (value) => {
            target.visible = value;
          },
        );
      },
      update: (progress) => {
        contribution?.set(
          Math.floor((progress * duration) / interval) % 2 !== 0,
        );
      },
      finish: () => contribution?.remove(),
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
