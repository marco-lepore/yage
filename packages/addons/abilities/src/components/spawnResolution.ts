import { Transform, Vec2 } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import {
  resolveAbilitySource,
  resolveAbilityTeam,
} from "../core/AbilitySpawned.js";
import type { StepContext } from "../core/types.js";
import { resolveHitSpec } from "../core/hit/delivery.js";
import type { HitDelivery, HitSpec } from "../core/hit/delivery.js";
import type { StandardHitData } from "../core/hit/types.js";
import { resolveAim } from "./aim.js";
import type { Aim } from "./aim.js";
import { HitReceiver } from "./HitReceiver.js";
import { createReportingDelivery } from "./reportedDelivery.js";

/** Shared resolution the `spawn` and `hitbox` steps need before they decide their own position. */
export interface ResolvedAbilitySpawn {
  readonly caster: Entity;
  readonly aim: Vec2;
  readonly team: string | undefined;
  readonly delivery: HitDelivery | undefined;
}

/** Arguments a delivery step passes to `resolveAbilitySpawn`. */
export interface AbilitySpawnResolveArgs<TData = StandardHitData> {
  ctx: StepContext;
  aim?: Aim;
  team?: string;
  hit?: HitSpec<TData>;
  tags?: readonly string[];
}

/**
 * Resolve the caster, aim, canonical team fallback, and optional hit delivery
 * for a step that spawns an attack entity (`spawn`, `hitbox`).
 *
 * Team resolution order: an explicit `team` argument, then the running
 * entity's own inherited spawn team (`resolveAbilityTeam` — set when the
 * entity is itself a spawned attack with a team in its own context), then
 * the resolved caster's `HitReceiver.team`. The caster (not the running
 * entity) is the team fallback's source: a nested spawn's own entity (a
 * hitbox, a projectile, an intermediate spawned attack) rarely carries a
 * `HitReceiver` itself, so falling back to the running entity's own would
 * silently drop the team in exactly the case that matters.
 */
export function resolveAbilitySpawn<TData = StandardHitData>(
  args: AbilitySpawnResolveArgs<TData>,
): ResolvedAbilitySpawn {
  const { ctx } = args;
  const aim = resolveAim(args.aim, ctx);
  const caster = resolveAbilitySource(ctx.entity);
  const team =
    args.team ??
    resolveAbilityTeam(ctx.entity) ??
    caster.tryGet(HitReceiver)?.team;
  const delivery =
    args.hit === undefined
      ? undefined
      : createReportingDelivery<TData>(
          {
            source: caster,
            data: resolveHitSpec(args.hit, ctx),
            ...(team !== undefined ? { team } : {}),
            ...(args.tags ? { tags: args.tags } : {}),
          },
          { ability: ctx.def },
        );
  return { caster, aim, team, delivery };
}

/** Resolve the running entity's position source for steps that require it. */
export function resolveAbilityTransform(
  ctx: StepContext,
  kind: string,
): Transform {
  const transform = ctx.entity.tryGet(Transform);
  if (!transform) {
    throw new Error(
      `Abilities: step "${kind}" requires a Transform component on the entity.`,
    );
  }
  return transform;
}
