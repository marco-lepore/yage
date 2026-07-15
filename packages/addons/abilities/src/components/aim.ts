import { Transform, Vec2 } from "@yagejs/core";
import type { Entity, Vec2Like } from "@yagejs/core";
import type { StepContext } from "../core/types.js";
import { Facing } from "./Facing.js";

/**
 * A firing/placement direction for a delivery step (hitbox, projectile):
 * an explicit vector, or a function resolved at fire time (snapshot
 * semantics — mirrors `HitSpec`). Omit `aim` on a step to fall back to the
 * caster's `Facing` component.
 */
export type Aim = Vec2Like | ((ctx: StepContext) => Vec2Like);

/**
 * Resolve a delivery step's aim to a unit vector at fire time. An explicit
 * `Aim` is resolved then normalized; an omitted `aim` reads the caster's
 * `Facing`. Throws when neither is available, or when an explicit aim
 * resolves to a zero vector — a delivery step with no direction is a bug,
 * not a silent +x default.
 */
export function resolveAim(aim: Aim | undefined, ctx: StepContext): Vec2 {
  if (aim === undefined) {
    const facing = ctx.entity.tryGet(Facing);
    if (!facing) {
      throw new Error(
        "Abilities: a delivery step needs an aim direction — add a Facing " +
          "component to the entity, or pass an explicit `aim` on the step.",
      );
    }
    return facing.unit;
  }
  const raw = typeof aim === "function" ? aim(ctx) : aim;
  const unit = new Vec2(raw.x, raw.y).normalize();
  if (unit === Vec2.ZERO) {
    throw new Error(
      "Abilities: a delivery step's aim resolved to a zero vector.",
    );
  }
  return unit;
}

/**
 * A fire-time `Aim` resolver that points from the caster to a target entity:
 * reads both `Transform.worldPosition`s and returns the delta (`resolveAim`
 * normalizes it). `getTarget` runs when the delivery step fires; throwing
 * when it returns no entity matches `resolveAim`'s loud-error style.
 *
 * With `{ face: true }` the resolver also points the caster's sibling
 * `Facing` at the target. That side effect happens at fire time, so timeline
 * steps earlier than the delivery still read the pre-fire facing — pair with
 * boundary resampling where an earlier step must see the new direction.
 */
export function aimAt(
  getTarget: (ctx: StepContext) => Entity | undefined,
  options: { face?: boolean } = {},
): (ctx: StepContext) => Vec2 {
  return (ctx) => {
    const target = getTarget(ctx);
    if (!target) {
      throw new Error(
        "Abilities: aimAt's getTarget returned no entity — a delivery step " +
          "needs a target to aim at.",
      );
    }
    const from = ctx.entity.get(Transform).worldPosition;
    const delta = target.get(Transform).worldPosition.sub(from);
    if (options.face) ctx.entity.tryGet(Facing)?.set(delta.x, delta.y);
    return delta;
  };
}
