import { defineStep } from "../../core/defineStep.js";
import { Stagger, setStaggerWindowEnabled } from "../Stagger.js";
import type { AbilityDef, StepContext } from "../../core/types.js";
import type { Vec2Like } from "@yagejs/core";

/**
 * Priority the built-in stagger reaction forces at. A game authors
 * super-armor moves above this number instead of a magic constant, and
 * stays below it for anything that should still flinch.
 */
export const REACTION_PRIORITY = 100;

/**
 * Drives the sibling `Stagger` component across the reaction's window:
 * `enter` starts the ramp, `exit` ends it (on both natural completion and
 * interruption — an interrupter's own motion write lands after this
 * zeroing, since exit-then-enter is the fixed ordering on a lane swap).
 * Requires a `Stagger` component on the entity, like `anim` requires
 * `KeyframeAnimator` — missing it throws.
 */
export const staggerMotion = defineStep<{
  direction: Vec2Like;
  knockback: number;
  stun: number;
}>("staggerMotion", {
  enter(params, ctx) {
    requireStagger(ctx).begin(params);
  },
  onDisable(_params, ctx) {
    setStaggerWindowEnabled(requireStagger(ctx), false);
  },
  onEnable(_params, ctx) {
    setStaggerWindowEnabled(requireStagger(ctx), true);
  },
  exit(_params, ctx) {
    requireStagger(ctx).end();
  },
});

function requireStagger(ctx: StepContext): Stagger {
  const stagger = ctx.entity.tryGet(Stagger);
  if (!stagger) {
    throw new Error(
      `Abilities: step "staggerMotion" requires a Stagger component on the entity.`,
    );
  }
  return stagger;
}

/**
 * Builds the forced stagger reaction def for one hit: a single-window
 * `main`-lane activation that owns the sibling `Stagger` for `stun`
 * seconds. `priority` defaults to `REACTION_PRIORITY`; a heavier/armored
 * variant can lower or raise it (see `reactionStep` in
 * `src/components/standardHit.ts`).
 */
export function staggerReaction(options: {
  direction: Vec2Like;
  knockback: number;
  stun: number;
  priority?: number;
}): AbilityDef {
  const { direction, knockback, stun, priority } = options;
  return {
    id: "stagger",
    lane: "main",
    priority: priority ?? REACTION_PRIORITY,
    timeline: [
      staggerMotion({ from: 0, to: stun, direction, knockback, stun }),
    ],
  };
}
