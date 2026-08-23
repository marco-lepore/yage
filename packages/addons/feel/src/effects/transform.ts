import {
  Transform,
  Vec2,
  easeOutQuad,
  type EasingFunction,
  type Vec2Like,
} from "@yagejs/core";
import { defineFeelEffect } from "../core/node.js";
import type { FeelEffectContext, FeelNode } from "../core/types.js";
import {
  addMotionContribution,
  type MotionContributionHandle,
} from "../internal/motionMixer.js";

export type FeelTransformTarget =
  | Transform
  | ((context: FeelEffectContext) => Transform);

interface PunchTimingOptions {
  /** Total duration in seconds. Default: 0.18. */
  duration?: number;
  /** Normalized time of maximum displacement. Default: 0.25. */
  peakAt?: number;
  /** Easing from rest to the peak. Default: `easeOutQuad`. */
  attackEasing?: EasingFunction;
  /** Easing from the peak back to rest. Default: `easeOutQuad`. */
  releaseEasing?: EasingFunction;
}

interface TransformEffectOptions extends PunchTimingOptions {
  /** Target transform. Default: the `Feel` entity's `Transform`. */
  target?: FeelTransformTarget;
}

export interface FeelPositionPunchOptions extends TransformEffectOptions {
  offset: Vec2Like;
}

export interface FeelRotationPunchOptions extends TransformEffectOptions {
  radians: number;
}

export interface FeelScalePunchOptions extends TransformEffectOptions {
  /** Peak scale factor. A number scales both axes. Default: 1.2. */
  scale?: number | Vec2Like;
}

export interface FeelSquashOptions extends TransformEffectOptions {
  /** Axis that stretches while the other axis contracts. Default: `"y"`. */
  axis?: "x" | "y";
  /** Peak stretch above 1. Default: 0.25. */
  amount?: number;
}

export interface FeelTransformShakeOptions {
  /** Target transform. Default: the `Feel` entity's `Transform`. */
  target?: FeelTransformTarget;
  /** Position amplitude in pixels. A number applies to both axes. Default: 4. */
  amplitude?: number | Vec2Like;
  /** Oscillations per second. Default: 28. */
  frequency?: number;
  /** Total duration in seconds. Default: 0.16. */
  duration?: number;
  /** Exponent applied to the fade to zero. Default: 1. */
  decay?: number;
}

export interface FeelRotationShakeOptions {
  target?: FeelTransformTarget;
  /** Rotation amplitude in radians. Default: 0.08. */
  radians?: number;
  frequency?: number;
  duration?: number;
  decay?: number;
}

/** Move away from the live position and return without replacing gameplay movement. */
export function feelPositionPunch(options: FeelPositionPunchOptions): FeelNode {
  return motionPunch(options, (handle, amount, intensity) => {
    handle.setPosition(
      new Vec2(
        options.offset.x * amount * intensity,
        options.offset.y * amount * intensity,
      ),
    );
  });
}

/** Rotate away from the live angle and return. */
export function feelRotationPunch(options: FeelRotationPunchOptions): FeelNode {
  return motionPunch(options, (handle, amount, intensity) => {
    handle.setRotation(options.radians * amount * intensity);
  });
}

/** Scale away from the live scale and return. */
export function feelScalePunch(options: FeelScalePunchOptions = {}): FeelNode {
  const configured = options.scale ?? 1.2;
  const peak =
    typeof configured === "number"
      ? new Vec2(configured, configured)
      : new Vec2(configured.x, configured.y);
  return motionPunch(options, (handle, amount, intensity) => {
    handle.setScale(
      new Vec2(
        1 + (peak.x - 1) * amount * intensity,
        1 + (peak.y - 1) * amount * intensity,
      ),
    );
  });
}

/** Stretch one axis while contracting the other, then return. */
export function feelSquash(options: FeelSquashOptions = {}): FeelNode {
  const axis = options.axis ?? "y";
  const amount = options.amount ?? 0.25;
  return motionPunch(options, (handle, progress, intensity) => {
    const stretch = Math.max(0.01, 1 + amount * progress * intensity);
    const squash = 1 / stretch;
    handle.setScale(
      axis === "x" ? new Vec2(stretch, squash) : new Vec2(squash, stretch),
    );
  });
}

/** Shake a transform around its live position with deterministic phases. */
export function feelTransformShake(
  options: FeelTransformShakeOptions = {},
): FeelNode {
  const duration = options.duration ?? 0.16;
  const frequency = options.frequency ?? 28;
  const decay = options.decay ?? 1;
  const configured = options.amplitude ?? 4;
  const amplitude =
    typeof configured === "number"
      ? new Vec2(configured, configured)
      : new Vec2(configured.x, configured.y);
  return defineFeelEffect(duration, (context) => {
    const target = resolveTarget(options.target, context);
    const phaseX = context.random.range(0, Math.PI * 2);
    const phaseY = context.random.range(0, Math.PI * 2);
    let handle: MotionContributionHandle | undefined;
    return {
      start: () => {
        handle = addMotionContribution(target);
      },
      update: (progress) => {
        const elapsed = progress * duration;
        const envelope = Math.pow(Math.max(0, 1 - progress), decay);
        handle?.setPosition(
          new Vec2(
            Math.sin(elapsed * frequency * Math.PI * 2 + phaseX) *
              amplitude.x *
              envelope *
              context.intensity,
            Math.sin(elapsed * frequency * Math.PI * 2 + phaseY) *
              amplitude.y *
              envelope *
              context.intensity,
          ),
        );
      },
      finish: () => handle?.remove(),
    };
  });
}

/** Wiggle a transform around its live rotation. */
export function feelRotationShake(
  options: FeelRotationShakeOptions = {},
): FeelNode {
  const duration = options.duration ?? 0.16;
  const frequency = options.frequency ?? 24;
  const decay = options.decay ?? 1;
  const radians = options.radians ?? 0.08;
  return defineFeelEffect(duration, (context) => {
    const target = resolveTarget(options.target, context);
    const phase = context.random.range(0, Math.PI * 2);
    let handle: MotionContributionHandle | undefined;
    return {
      start: () => {
        handle = addMotionContribution(target);
      },
      update: (progress) => {
        const elapsed = progress * duration;
        const envelope = Math.pow(Math.max(0, 1 - progress), decay);
        handle?.setRotation(
          Math.sin(elapsed * frequency * Math.PI * 2 + phase) *
            radians *
            envelope *
            context.intensity,
        );
      },
      finish: () => handle?.remove(),
    };
  });
}

/** Convenience recoil: a position punch opposite `direction`. */
export function feelRecoil(options: {
  direction: Vec2Like;
  distance?: number;
  target?: FeelTransformTarget;
  duration?: number;
}): FeelNode {
  const direction = new Vec2(
    options.direction.x,
    options.direction.y,
  ).normalize();
  const distance = options.distance ?? 8;
  return feelPositionPunch({
    offset: direction.scale(-distance),
    ...(options.target !== undefined ? { target: options.target } : {}),
    ...(options.duration !== undefined ? { duration: options.duration } : {}),
  });
}

/** Convenience bounce: a vertical position punch. */
export function feelBounce(
  options: {
    distance?: number;
    target?: FeelTransformTarget;
    duration?: number;
  } = {},
): FeelNode {
  return feelPositionPunch({
    offset: new Vec2(0, -(options.distance ?? 8)),
    ...(options.target !== undefined ? { target: options.target } : {}),
    ...(options.duration !== undefined ? { duration: options.duration } : {}),
  });
}

function motionPunch(
  options: TransformEffectOptions,
  apply: (
    handle: MotionContributionHandle,
    amount: number,
    intensity: number,
  ) => void,
): FeelNode {
  const duration = options.duration ?? 0.18;
  const peakAt = options.peakAt ?? 0.25;
  if (!Number.isFinite(peakAt) || peakAt < 0 || peakAt > 1) {
    throw new Error(`Feel transform punch: peakAt must be between 0 and 1.`);
  }
  const attack = options.attackEasing ?? easeOutQuad;
  const release = options.releaseEasing ?? easeOutQuad;
  return defineFeelEffect(duration, (context) => {
    const target = resolveTarget(options.target, context);
    let handle: MotionContributionHandle | undefined;
    return {
      start: () => {
        handle = addMotionContribution(target);
      },
      update: (progress) => {
        if (handle)
          apply(
            handle,
            punchAmount(progress, peakAt, attack, release),
            context.intensity,
          );
      },
      finish: () => handle?.remove(),
    };
  });
}

function punchAmount(
  progress: number,
  peakAt: number,
  attack: EasingFunction,
  release: EasingFunction,
): number {
  if (peakAt <= 0) return 1 - release(progress);
  if (peakAt >= 1) return attack(progress);
  if (progress <= peakAt) return attack(progress / peakAt);
  return 1 - release((progress - peakAt) / (1 - peakAt));
}

function resolveTarget(
  target: FeelTransformTarget | undefined,
  context: FeelEffectContext,
): Transform {
  if (!target) return context.entity.get(Transform);
  return typeof target === "function" ? target(context) : target;
}
