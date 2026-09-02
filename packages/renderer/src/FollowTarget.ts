import { Entity, Transform } from "@yagejs/core";
import type { Component, Vec2Like } from "@yagejs/core";
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
): Vec2Like | undefined {
  if (typeof target === "function") {
    const name = (owner.entity as Entity | undefined)?.name;
    return attributed(
      boundaryFor(owner),
      {
        kind: "Follow target function",
        ...(name !== undefined ? { entity: name } : {}),
      },
      target,
    );
  }
  if (target instanceof Entity) return target.tryGet(Transform)?.worldPosition;
  if (target instanceof Transform) return target.worldPosition;
  return target;
}
