import { Vec2 } from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";
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
