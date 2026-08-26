import {
  Vec2,
  easeOutQuad,
  type EasingFunction,
  type Vec2Like,
} from "@yagejs/core";
import type {
  VisualComponent,
  VisualTransformModifierHandle,
} from "@yagejs/renderer";
import { defineFeelEffect } from "../core/node.js";
import type { FeelEffectContext, FeelNode } from "../core/types.js";
import { feelPunchAmount, validateFeelPeakAt } from "../internal/envelope.js";

export type FeelVisualTarget =
  | VisualComponent
  | ((context: FeelEffectContext) => VisualComponent);

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

interface VisualTransformEffectOptions extends PunchTimingOptions {
  /** Visual component whose rendered transform receives the contribution. */
  target: FeelVisualTarget;
}

interface SpringTimingOptions {
  /** Total settling time in seconds. Default: 0.5. */
  duration?: number;
  /** Number of oscillations before settling. Default: 2.5. */
  oscillations?: number;
  /** Exponent applied to the decay toward rest. Default: 2. */
  decay?: number;
}

interface VisualSpringEffectOptions extends SpringTimingOptions {
  /** Visual component whose rendered transform receives the contribution. */
  target: FeelVisualTarget;
}

export interface FeelPositionPunchOptions extends VisualTransformEffectOptions {
  offset: Vec2Like;
}

export interface FeelRotationPunchOptions extends VisualTransformEffectOptions {
  radians: number;
}

export interface FeelScalePunchOptions extends VisualTransformEffectOptions {
  /** Peak scale factor. A number scales both axes. Default: 1.2. */
  scale?: number | Vec2Like;
}

export interface FeelPositionSpringOptions extends VisualSpringEffectOptions {
  /** Initial rendered position offset in pixels. */
  offset: Vec2Like;
}

export interface FeelRotationSpringOptions extends VisualSpringEffectOptions {
  /** Initial rendered rotation offset in radians. */
  radians: number;
}

export interface FeelScaleSpringOptions extends VisualSpringEffectOptions {
  /** Initial scale factor. A number scales both axes. Default: 1.2. */
  scale?: number | Vec2Like;
}

export interface FeelSquashOptions extends VisualTransformEffectOptions {
  /** Axis that stretches while the other axis contracts. Default: `"y"`. */
  axis?: "x" | "y";
  /** Peak stretch above 1. Default: 0.25. */
  amount?: number;
}

export interface FeelTransformShakeOptions {
  target: FeelVisualTarget;
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
  target: FeelVisualTarget;
  /** Rotation amplitude in radians. Default: 0.08. */
  radians?: number;
  /** Oscillations per second. Default: 24. */
  frequency?: number;
  /** Total duration in seconds. Default: 0.16. */
  duration?: number;
  /** Exponent applied to the fade to zero. Default: 1. */
  decay?: number;
}

export interface FeelScaleShakeOptions {
  target: FeelVisualTarget;
  /** Scale amplitude around `1`. A number applies to both axes. Default: `0.08`. */
  amplitude?: number | Vec2Like;
  /** Oscillations per second. Default: `24`. */
  frequency?: number;
  /** Total duration in seconds. Default: `0.16`. */
  duration?: number;
  /** Exponent applied to the fade to zero. Default: `1`. */
  decay?: number;
}

/** Move a visual away from its live position and return. */
export function feelPositionPunch(options: FeelPositionPunchOptions): FeelNode {
  return visualPunch(options, (handle, amount, intensity) => {
    handle.setPosition(
      new Vec2(
        options.offset.x * amount * intensity,
        options.offset.y * amount * intensity,
      ),
    );
  });
}

/** Rotate a visual away from its live angle and return. */
export function feelRotationPunch(options: FeelRotationPunchOptions): FeelNode {
  return visualPunch(options, (handle, amount, intensity) => {
    handle.setRotation(options.radians * amount * intensity);
  });
}

/** Scale a visual away from its live scale and return. */
export function feelScalePunch(options: FeelScalePunchOptions): FeelNode {
  const configured = options.scale ?? 1.2;
  const peak =
    typeof configured === "number"
      ? new Vec2(configured, configured)
      : new Vec2(configured.x, configured.y);
  return visualPunch(options, (handle, amount, intensity) => {
    handle.setScale(
      new Vec2(
        1 + (peak.x - 1) * amount * intensity,
        1 + (peak.y - 1) * amount * intensity,
      ),
    );
  });
}

/** Displace a visual's rendered position and spring back to its live position. */
export function feelPositionSpring(
  options: FeelPositionSpringOptions,
): FeelNode {
  return visualSpring(
    "feelPositionSpring",
    options,
    (handle, amount, intensity) => {
      handle.setPosition(
        new Vec2(
          options.offset.x * amount * intensity,
          options.offset.y * amount * intensity,
        ),
      );
    },
  );
}

/** Displace a visual's rendered rotation and spring back to its live angle. */
export function feelRotationSpring(
  options: FeelRotationSpringOptions,
): FeelNode {
  return visualSpring(
    "feelRotationSpring",
    options,
    (handle, amount, intensity) => {
      handle.setRotation(options.radians * amount * intensity);
    },
  );
}

/** Displace a visual's rendered scale and spring back to its live scale. */
export function feelScaleSpring(options: FeelScaleSpringOptions): FeelNode {
  const configured = options.scale ?? 1.2;
  const initial =
    typeof configured === "number"
      ? new Vec2(configured, configured)
      : new Vec2(configured.x, configured.y);
  return visualSpring(
    "feelScaleSpring",
    options,
    (handle, amount, intensity) => {
      handle.setScale(
        new Vec2(
          Math.max(0.0001, 1 + (initial.x - 1) * amount * intensity),
          Math.max(0.0001, 1 + (initial.y - 1) * amount * intensity),
        ),
      );
    },
  );
}

/** Stretch one visual axis while contracting the other, then return. */
export function feelSquash(options: FeelSquashOptions): FeelNode {
  const axis = options.axis ?? "y";
  const amount = options.amount ?? 0.25;
  return visualPunch(options, (handle, progress, intensity) => {
    const stretch = Math.max(0.01, 1 + amount * progress * intensity);
    const squash = 1 / stretch;
    handle.setScale(
      axis === "x" ? new Vec2(stretch, squash) : new Vec2(squash, stretch),
    );
  });
}

/** Shake a visual around its live rendered position with deterministic phases. */
export function feelTransformShake(
  options: FeelTransformShakeOptions,
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
    const target = resolveVisual(options.target, context);
    const phaseX = context.random.range(0, Math.PI * 2);
    const phaseY = context.random.range(0, Math.PI * 2);
    let handle: VisualTransformModifierHandle | undefined;
    return {
      start: () => {
        handle = target.modifiers.addTransform();
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

/** Wiggle a visual around its live rendered rotation. */
export function feelRotationShake(options: FeelRotationShakeOptions): FeelNode {
  const duration = options.duration ?? 0.16;
  const frequency = options.frequency ?? 24;
  const decay = options.decay ?? 1;
  const radians = options.radians ?? 0.08;
  return defineFeelEffect(duration, (context) => {
    const target = resolveVisual(options.target, context);
    const phase = context.random.range(0, Math.PI * 2);
    let handle: VisualTransformModifierHandle | undefined;
    return {
      start: () => {
        handle = target.modifiers.addTransform();
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

/** Shake a visual's rendered scale around its live base scale. */
export function feelScaleShake(options: FeelScaleShakeOptions): FeelNode {
  const duration = options.duration ?? 0.16;
  const frequency = options.frequency ?? 24;
  const decay = options.decay ?? 1;
  const configured = options.amplitude ?? 0.08;
  const amplitude =
    typeof configured === "number"
      ? new Vec2(configured, configured)
      : new Vec2(configured.x, configured.y);
  return defineFeelEffect(duration, (context) => {
    const target = resolveVisual(options.target, context);
    const phaseX = context.random.range(0, Math.PI * 2);
    const phaseY = context.random.range(0, Math.PI * 2);
    let handle: VisualTransformModifierHandle | undefined;
    return {
      start: () => {
        handle = target.modifiers.addTransform();
      },
      update: (progress) => {
        const elapsed = progress * duration;
        const envelope = Math.pow(Math.max(0, 1 - progress), decay);
        handle?.setScale(
          new Vec2(
            Math.max(
              0.0001,
              1 +
                Math.sin(elapsed * frequency * Math.PI * 2 + phaseX) *
                  amplitude.x *
                  envelope *
                  context.intensity,
            ),
            Math.max(
              0.0001,
              1 +
                Math.sin(elapsed * frequency * Math.PI * 2 + phaseY) *
                  amplitude.y *
                  envelope *
                  context.intensity,
            ),
          ),
        );
      },
      finish: () => handle?.remove(),
    };
  });
}

/** Position punch opposite `direction`. */
export function feelRecoil(options: {
  direction: Vec2Like;
  distance?: number;
  target: FeelVisualTarget;
  duration?: number;
}): FeelNode {
  const direction = new Vec2(
    options.direction.x,
    options.direction.y,
  ).normalize();
  return feelPositionPunch({
    target: options.target,
    offset: direction.scale(-(options.distance ?? 8)),
    ...(options.duration !== undefined ? { duration: options.duration } : {}),
  });
}

/** Vertical position punch. */
export function feelBounce(options: {
  distance?: number;
  target: FeelVisualTarget;
  duration?: number;
}): FeelNode {
  return feelPositionPunch({
    target: options.target,
    offset: new Vec2(0, -(options.distance ?? 8)),
    ...(options.duration !== undefined ? { duration: options.duration } : {}),
  });
}

function visualPunch(
  options: VisualTransformEffectOptions,
  apply: (
    handle: VisualTransformModifierHandle,
    amount: number,
    intensity: number,
  ) => void,
): FeelNode {
  const duration = options.duration ?? 0.18;
  validateFeelPeakAt(options.peakAt);
  const attack = options.attackEasing ?? easeOutQuad;
  const release = options.releaseEasing ?? easeOutQuad;
  return defineFeelEffect(duration, (context) => {
    const target = resolveVisual(options.target, context);
    let handle: VisualTransformModifierHandle | undefined;
    return {
      start: () => {
        handle = target.modifiers.addTransform();
      },
      update: (progress) => {
        if (!handle) return;
        apply(
          handle,
          feelPunchAmount(progress, options.peakAt, attack, release),
          context.intensity,
        );
      },
      finish: () => handle?.remove(),
    };
  });
}

function visualSpring(
  label: string,
  options: VisualSpringEffectOptions,
  apply: (
    handle: VisualTransformModifierHandle,
    amount: number,
    intensity: number,
  ) => void,
): FeelNode {
  const duration = options.duration ?? 0.5;
  const oscillations = options.oscillations ?? 2.5;
  const decay = options.decay ?? 2;
  validatePositiveSpringOption(label, "oscillations", oscillations);
  validatePositiveSpringOption(label, "decay", decay);
  return defineFeelEffect(duration, (context) => {
    const target = resolveVisual(options.target, context);
    let handle: VisualTransformModifierHandle | undefined;
    return {
      start: () => {
        handle = target.modifiers.addTransform();
      },
      update: (progress) => {
        if (!handle) return;
        const envelope = Math.pow(Math.max(0, 1 - progress), decay);
        const oscillation = Math.cos(progress * oscillations * Math.PI * 2);
        apply(handle, oscillation * envelope, context.intensity);
      },
      finish: () => handle?.remove(),
    };
  });
}

function validatePositiveSpringOption(
  label: string,
  option: string,
  value: number,
): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `${label}: ${option} must be a finite number > 0, got ${value}.`,
    );
  }
}

function resolveVisual(
  target: FeelVisualTarget,
  context: FeelEffectContext,
): VisualComponent {
  if (typeof target !== "function") return target;
  let visual: VisualComponent | undefined;
  context.invoke("visual target source", () => {
    visual = target(context);
  });
  return visual as VisualComponent;
}
