import { KeyframeAnimator } from "@yagejs/core";
import { defineStep } from "../../core/defineStep.js";

/** Plays a named `KeyframeAnimator` animation. Requires that component on the entity. */
export const anim = defineStep("anim", {
  fire: (params: { name: string }, ctx) => {
    const animator = ctx.entity.tryGet(KeyframeAnimator);
    if (!animator) {
      throw new Error(
        `Abilities: step "anim" (animation "${params.name}") requires a KeyframeAnimator component on the entity.`,
      );
    }
    animator.play(params.name);
  },
});
