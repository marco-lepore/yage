import {
  KeyframeAnimator,
  SceneTimeKey,
  type SceneTimeFreezeOptions,
  type SceneTimeScaleOptions,
} from "@yagejs/core";
import { defineFeelEffect } from "../core/node.js";
import type { FeelEffectContext, FeelNode } from "../core/types.js";

/** Invoke a game callback at this point in a cue. */
export function feelCall(
  callback: (context: FeelEffectContext) => void,
  label = "call",
): FeelNode {
  return defineFeelEffect(0, (context) => ({
    label,
    start: () => callback(context),
  }));
}

/** Play a named `KeyframeAnimator` animation. */
export function feelAnimation(
  name: string,
  target?:
    | KeyframeAnimator
    | ((context: FeelEffectContext) => KeyframeAnimator),
): FeelNode {
  return defineFeelEffect(0, (context) => ({
    start: () => {
      const animator = target
        ? typeof target === "function"
          ? target(context)
          : target
        : context.entity.get(KeyframeAnimator);
      animator.play(name);
    },
  }));
}

export interface FeelHitStopOptions extends SceneTimeFreezeOptions {
  /** Real-time freeze duration in seconds. Default: 0.05. */
  duration?: number;
}

/** Freeze the owning scene through its composable `SceneTime` service. */
export function feelHitStop(options: FeelHitStopOptions = {}): FeelNode {
  return defineFeelEffect(0, (context) => ({
    start: () => {
      context.resolve(SceneTimeKey).freezeFor(options.duration ?? 0.05, {
        key: options.key ?? "feel:hitstop",
        ...(options.label !== undefined ? { label: options.label } : {}),
      });
    },
  }));
}

export interface FeelSlowMotionOptions {
  /** Time scale factor. Must be greater than 0. Default: 0.35. */
  scale?: number;
  /** Real-time duration in seconds. Default: 0.2. */
  duration?: number;
  /** Slow the entity that owns `Feel` too. Default: false. */
  includeOwner?: boolean;
  key?: string;
  label?: string;
}

/** Apply a timed scene time-scale request. */
export function feelSlowMotion(options: FeelSlowMotionOptions = {}): FeelNode {
  return defineFeelEffect(0, (context) => ({
    start: () => {
      const scaleOptions: SceneTimeScaleOptions = {
        for: options.duration ?? 0.2,
        key: options.key ?? "feel:slowmo",
        ...(options.label !== undefined ? { label: options.label } : {}),
        ...(options.includeOwner ? {} : { excludeUpdates: [context.entity] }),
      };
      context
        .resolve(SceneTimeKey)
        .scaleBy(options.scale ?? 0.35, scaleOptions);
    },
  }));
}
