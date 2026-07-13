import { Transform, Vec2, entityClassHasTrait } from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";
import {
  AbilitySpawned,
  resolveAbilitySource,
} from "../../core/AbilitySpawned.js";
import type {
  AbilitySpawnContext,
  AbilitySpawnedClass,
  AbilitySpawnParams,
} from "../../core/AbilitySpawned.js";
import { resolveHitSpec } from "../../core/hit/delivery.js";
import type { HitSpec } from "../../core/hit/delivery.js";
import type { StandardHitData } from "../../core/hit/types.js";
import type { PointStep, StepContext } from "../../core/types.js";
import { resolveAim } from "../aim.js";
import type { Aim } from "../aim.js";
import { HitReceiver } from "../HitReceiver.js";
import { createReportingDelivery } from "../reportedDelivery.js";

/** Parameters shared by `spawn` and built-ins implemented through it. */
export interface SpawnParams<
  TClass extends AbilitySpawnedClass,
  TData = StandardHitData,
> {
  /** Game-owned entity class configured through `setup` as it enters the scene. */
  entity: TClass;
  /** Parameters inferred from the entity class's `setup` context. */
  params: AbilitySpawnParams<TClass>;
  /** Firing direction; omit to read the running entity's `Facing`. */
  aim?: Aim;
  /** Team stamped into the optional delivery; omit to inherit it. */
  team?: string;
  /** Optional hit payload resolved once when the step fires. */
  hit?: HitSpec<TData>;
  /** Tags stamped into the optional delivery. */
  tags?: readonly string[];
  /** Spawn offset in the +x facing-local frame, rotated by aim. */
  offset?: Vec2Like;
}

/** Arguments accepted by the typed point-in-time `spawn` factory. */
export type SpawnStepArgs<
  TClass extends AbilitySpawnedClass,
  TData = StandardHitData,
> = SpawnParams<TClass, TData> & { at: number };

/**
 * Spawn a game-owned attack entity from an ability timeline. The entity owns
 * its components, presentation, behavior, repeated delivery, and lifetime.
 */
export function spawn<
  TClass extends AbilitySpawnedClass,
  TData = StandardHitData,
>(args: SpawnStepArgs<TClass, TData>): PointStep<SpawnParams<TClass, TData>> {
  return createSpawnStep("spawn", args);
}

/** Build a point step that uses the shared spawned-attack mechanism. */
function createSpawnStep<
  TClass extends AbilitySpawnedClass,
  TData = StandardHitData,
>(
  kind: string,
  args: SpawnStepArgs<TClass, TData>,
): PointStep<SpawnParams<TClass, TData>> {
  const { at, ...params } = args;
  return {
    kind,
    at,
    params,
    hooks: { fire: fireSpawn },
  };
}

function fireSpawn<TClass extends AbilitySpawnedClass, TData>(
  params: SpawnParams<TClass, TData>,
  ctx: StepContext,
): void {
  const kind = ctxStepKind(ctx, params);
  if (!entityClassHasTrait(params.entity, AbilitySpawned)) {
    throw new Error(
      `Abilities: step "${kind}" requires the spawned entity to declare the AbilitySpawned trait.`,
    );
  }

  const aim = resolveAim(params.aim, ctx);
  const transform = ctx.entity.tryGet(Transform);
  if (!transform) {
    throw new Error(
      `Abilities: step "${kind}" requires a Transform component on the entity.`,
    );
  }

  const position = params.offset
    ? transform.worldPosition.add(
        new Vec2(params.offset.x, params.offset.y).rotate(aim.angle()),
      )
    : transform.worldPosition;
  const caster = resolveAbilitySource(ctx.entity);
  const inheritedTeam = ctx.entity.hasTrait(AbilitySpawned)
    ? ctx.entity.abilitySpawnContext?.team
    : undefined;
  const team = params.team ?? inheritedTeam ?? caster.tryGet(HitReceiver)?.team;
  const delivery =
    params.hit === undefined
      ? undefined
      : createReportingDelivery<TData>({
          source: caster,
          data: resolveHitSpec(params.hit, ctx),
          ...(team !== undefined ? { team } : {}),
          ...(params.tags ? { tags: params.tags } : {}),
        });
  const context: AbilitySpawnContext<AbilitySpawnParams<TClass>> = {
    caster,
    aim,
    position,
    params: params.params,
    ...(team !== undefined ? { team } : {}),
    ...(delivery ? { delivery } : {}),
  };

  ctx.entity.scene.spawn(params.entity, context);
}

function ctxStepKind<TClass extends AbilitySpawnedClass, TData>(
  ctx: StepContext,
  params: SpawnParams<TClass, TData>,
): string {
  return (
    ctx.def.timeline.find((step) => step.params === params)?.kind ?? "spawn"
  );
}
