import { AnimationController } from "@yagejs/renderer";
import { defineFeelEffect } from "../core/node.js";
import type { FeelEffectContext, FeelNode } from "../core/types.js";

export type FeelSpriteAnimationMode = "play" | "force" | "oneShot";

export type FeelSpriteAnimationTarget<T extends string = string> =
  | AnimationController<T>
  | ((context: FeelEffectContext) => AnimationController<T>);

export interface FeelSpriteAnimationOptions<T extends string = string> {
  /** Controller to play. Defaults to the `Feel` entity's sibling controller. */
  target?: FeelSpriteAnimationTarget<T>;
  /** Playback behavior. Default: `"play"`. */
  mode?: FeelSpriteAnimationMode;
  /** One-shot lock duration in engine-scaled seconds. */
  duration?: number;
  /** Called when a one-shot lock completes. */
  onComplete?: () => void;
  /** Called when another play, unlock, or entity destruction interrupts the one-shot. */
  onCancel?: () => void;
}

/** Start a named `AnimationController` sprite animation. */
export function feelSpriteAnimation<T extends string = string>(
  name: T,
  options: FeelSpriteAnimationOptions<T> = {},
): FeelNode {
  const mode = options.mode ?? "play";
  if (
    mode !== "oneShot" &&
    (options.duration !== undefined ||
      options.onComplete !== undefined ||
      options.onCancel !== undefined)
  ) {
    throw new Error(
      'feelSpriteAnimation: duration, onComplete and onCancel require mode "oneShot".',
    );
  }
  if (
    options.duration !== undefined &&
    (!Number.isFinite(options.duration) || options.duration < 0)
  ) {
    throw new Error(
      `feelSpriteAnimation: duration must be finite and >= 0, got ${options.duration}.`,
    );
  }
  return defineFeelEffect(options.duration ?? 0, (context) => ({
    start: () => {
      const controller = resolveController(options.target, context);
      if (mode === "force") {
        controller.forcePlay(name);
        return;
      }
      if (mode === "oneShot") {
        const completion = options.onComplete;
        const onComplete = completion
          ? () => context.invoke("sprite animation completion", completion)
          : undefined;
        const cancellation = options.onCancel;
        const onCancel = cancellation
          ? () => context.invoke("sprite animation cancellation", cancellation)
          : undefined;
        controller.playOneShot(name, {
          ...(options.duration !== undefined
            ? { duration: context.duration }
            : {}),
          ...(onComplete ? { onComplete } : {}),
          ...(onCancel ? { onCancel } : {}),
        });
        return;
      }
      controller.play(name);
    },
  }));
}

function resolveController<T extends string>(
  target: FeelSpriteAnimationTarget<T> | undefined,
  context: FeelEffectContext,
): AnimationController<T> {
  if (target === undefined) {
    return context.entity.get(AnimationController) as AnimationController<T>;
  }
  if (typeof target !== "function") return target;
  let controller: AnimationController<T> | undefined;
  context.invoke("sprite animation target", () => {
    controller = target(context);
  });
  return controller as AnimationController<T>;
}
