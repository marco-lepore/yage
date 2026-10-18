import type { BehaviorNodes } from "./types.js";

/** Pin the game's context type once. These helpers only construct plain data. */
export function behaviorNodes<C>(): BehaviorNodes<C> {
  return {
    action: (id, create) => ({ kind: "action", id, create }),
    condition: (id, test) => ({ kind: "condition", id, test }),
    sequence: (id, children, options) => ({
      kind: "sequence",
      id,
      children,
      ...options,
    }),
    selector: (id, children, options) => ({
      kind: "selector",
      id,
      children,
      ...options,
    }),
    guard: (id, test, child) => ({ kind: "guard", id, test, child }),
    subtree: (id, child) => ({ kind: "subtree", id, child }),
    invert: (id, child) => ({ kind: "invert", id, child }),
    wait: (id, seconds) => ({ kind: "wait", id, seconds }),
    randomWait: (id, min, max) => ({ kind: "randomWait", id, min, max }),
    chance: (id, probability, child) => ({
      kind: "chance",
      id,
      probability,
      child,
    }),
    weightedSelector: (id, choices, options) => ({
      kind: "weightedSelector",
      id,
      choices,
      ...options,
    }),
    cooldown: (id, seconds, child) => ({
      kind: "cooldown",
      id,
      seconds,
      child,
    }),
    timeout: (id, seconds, child) => ({ kind: "timeout", id, seconds, child }),
  };
}
