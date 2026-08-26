import {
  type Entity,
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
export function feelKeyframeAnimation(
  name: string,
  target?:
    | KeyframeAnimator
    | ((context: FeelEffectContext) => KeyframeAnimator),
): FeelNode {
  return defineFeelEffect(0, (context) => ({
    start: () => {
      const animator = resolveKeyframeTarget(target, context);
      animator.play(name);
    },
  }));
}

function resolveKeyframeTarget(
  target:
    | KeyframeAnimator
    | ((context: FeelEffectContext) => KeyframeAnimator)
    | undefined,
  context: FeelEffectContext,
): KeyframeAnimator {
  if (target === undefined) return context.entity.get(KeyframeAnimator);
  if (typeof target !== "function") return target;
  let animator: KeyframeAnimator | undefined;
  context.invoke("keyframe animation target", () => {
    animator = target(context);
  });
  return animator as KeyframeAnimator;
}

export interface FeelHitStopOptions extends SceneTimeFreezeOptions {
  /** Real-time freeze duration in seconds. Default: 0.05. */
  duration?: number;
  /** Freeze the entity that owns `Feel` too. Default: true. */
  includeOwner?: boolean;
}

/** Freeze the owning scene through its composable `SceneTime` service. */
export function feelHitStop(options: FeelHitStopOptions = {}): FeelNode {
  return defineFeelEffect(0, (context) => ({
    start: () => {
      const excluded = options.excludeUpdates
        ? [...options.excludeUpdates]
        : [];
      if (options.includeOwner === false) excluded.push(context.entity);
      context.resolve(SceneTimeKey).freezeFor(options.duration ?? 0.05, {
        key: options.key ?? "feel:hitstop",
        ...(excluded.length > 0 ? { excludeUpdates: excluded } : {}),
        ...(options.label !== undefined ? { label: options.label } : {}),
      });
    },
  }));
}

export type FeelEntityTarget =
  | Entity
  | ((context: FeelEffectContext) => Entity);

interface FeelSlowMotionBaseOptions {
  /** Time scale factor. Must be greater than 0. Default: 0.35. */
  scale?: number;
  /** Real-time duration in seconds. Default: 0.2. */
  duration?: number;
  key?: string;
  label?: string;
}

export interface FeelSceneSlowMotionOptions extends FeelSlowMotionBaseOptions {
  target?: undefined;
  /** Slow the entity that owns `Feel` too. Default: false. */
  includeOwner?: boolean;
}

export interface FeelTargetSlowMotionOptions extends FeelSlowMotionBaseOptions {
  /** Scale only this entity's updates. Physics keeps the scene's time scale. */
  target: FeelEntityTarget;
  includeOwner?: never;
}

export type FeelSlowMotionOptions =
  | FeelSceneSlowMotionOptions
  | FeelTargetSlowMotionOptions;

/** Apply a timed scene time-scale request. */
export function feelSlowMotion(options: FeelSlowMotionOptions = {}): FeelNode {
  return defineFeelEffect(0, (context) => ({
    start: () => {
      const time = context.resolve(SceneTimeKey);
      if (options.target !== undefined) {
        time.scaleEntityBy(
          resolveEntityTarget(options.target, context, "slow-motion target"),
          options.scale ?? 0.35,
          {
            for: options.duration ?? 0.2,
            key: options.key ?? "feel:target-slowmo",
            ...(options.label !== undefined ? { label: options.label } : {}),
          },
        );
        return;
      }
      const scaleOptions: SceneTimeScaleOptions = {
        for: options.duration ?? 0.2,
        key: options.key ?? "feel:slowmo",
        ...(options.label !== undefined ? { label: options.label } : {}),
        ...(options.includeOwner ? {} : { excludeUpdates: [context.entity] }),
      };
      time.scaleBy(options.scale ?? 0.35, scaleOptions);
    },
  }));
}

export interface FeelTargetFreezeOptions {
  /** Entity whose updates should stop. Physics keeps the scene's time scale. */
  target: FeelEntityTarget;
  /** Real-time freeze duration in seconds. Default: 0.05. */
  duration?: number;
  key?: string;
  label?: string;
}

/** Freeze one entity's updates without freezing its scene or rigid body. */
export function feelTargetFreeze(options: FeelTargetFreezeOptions): FeelNode {
  return defineFeelEffect(0, (context) => ({
    start: () => {
      context
        .resolve(SceneTimeKey)
        .freezeEntityFor(
          resolveEntityTarget(options.target, context, "freeze target"),
          options.duration ?? 0.05,
          {
            key: options.key ?? "feel:target-freeze",
            ...(options.label !== undefined ? { label: options.label } : {}),
          },
        );
    },
  }));
}

function resolveEntityTarget(
  target: FeelEntityTarget,
  context: FeelEffectContext,
  label: string,
): Entity {
  if (typeof target !== "function") return target;
  let entity: Entity | undefined;
  context.invoke(label, () => {
    entity = target(context);
  });
  return entity as Entity;
}
