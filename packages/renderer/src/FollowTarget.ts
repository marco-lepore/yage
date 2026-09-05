import { Entity, Transform, Vec2 } from "@yagejs/core";
import type { Component, Vec2Like, Vec2Buffer } from "@yagejs/core";
import { attributed, boundaryFor } from "./internal/attribution.js";

/**
 * What a follow tracks each frame, always in world coordinates. An `Entity`
 * or a `Transform` reads the current `worldPosition`, so a target parented
 * under a moving platform tracks where it actually is on screen; a `Vec2Like`
 * is a fixed world coord; a function is called every frame and may compute
 * any world coord (the midpoint of two entities, a position along a path).
 */
export type FollowTarget = Entity | Transform | Vec2Like | (() => Vec2Like);

/**
 * Current world position of a follow target, or `undefined` when the target
 * cannot supply one (an entity without a `Transform`). A function target runs
 * through the error boundary, so a throw is attributed to the game's callback.
 * @internal
 */
export function resolveFollowTarget(
  target: FollowTarget,
  owner: Component,
  out: Vec2Buffer,
): Vec2Buffer | undefined {
  if (typeof target === "function") {
    const name = (owner.entity as Entity | undefined)?.name;
    const position = attributed(
      boundaryFor(owner),
      {
        kind: "Follow target function",
        ...(name !== undefined ? { entity: name } : {}),
      },
      target,
    );
    return Vec2.copyInto(out, position);
  }
  if (target instanceof Entity)
    return target.tryGet(Transform)?.getWorldPositionInto(out);
  if (target instanceof Transform) return target.getWorldPositionInto(out);
  return Vec2.copyInto(out, target);
}
