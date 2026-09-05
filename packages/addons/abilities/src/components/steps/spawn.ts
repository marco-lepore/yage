import { ErrorBoundaryKey, Vec2, entityClassHasTrait } from "@yagejs/core";
import type { Entity, Vec2Like } from "@yagejs/core";
import { AbilitySpawned } from "../../core/AbilitySpawned.js";
import type {
  AbilitySpawnContext,
  AbilitySpawnedClass,
  AbilitySpawnParams,
} from "../../core/AbilitySpawned.js";
import type { HitSpec } from "../../core/hit/delivery.js";
import type { StandardHitData } from "../../core/hit/types.js";
import type { PointStep, StepContext } from "../../core/types.js";
import {
  resolveAbilitySpawn,
  resolveAbilityTransform,
} from "../spawnResolution.js";
import type { Aim } from "../aim.js";

/** Absolute world position for a spawned entity, resolved when the step fires. */
export type SpawnPosition = Vec2Like | ((ctx: StepContext) => Vec2Like);

/** Parameters shared by `spawn` and built-ins implemented through it. */
export interface SpawnParams<
  TClass extends AbilitySpawnedClass,
  TData = StandardHitData,
> {
  /** Game-owned entity class configured through `setup` as it enters the scene. */
  entity: TClass;
  /** Parameters inferred from the entity class's `setup` context. */
  params: AbilitySpawnParams<TClass>;
  /** Acquire a game-owned instance. Undefined skips this spawn (for example, a full pool). */
  acquire?: (
    context: AbilitySpawnContext<AbilitySpawnParams<TClass>>,
    stepContext: StepContext,
  ) => InstanceType<TClass> | undefined;
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
  /** Absolute world-position base; omit to use the running entity's Transform. */
  position?: SpawnPosition;
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
  const { at, ...params } = args;
  return {
    kind: "spawn",
    at,
    params,
    hooks: {
      fire: fireSpawn,
    },
  };
}

function fireSpawn<TClass extends AbilitySpawnedClass, TData>(
  params: SpawnParams<TClass, TData>,
  ctx: StepContext,
): void {
  if (!entityClassHasTrait(params.entity, AbilitySpawned)) {
    throw new Error(
      `Abilities: step "spawn" requires the spawned entity to declare the AbilitySpawned trait.`,
    );
  }

  const resolved = resolveAbilitySpawn<TData>({
    ctx,
    ...(params.aim !== undefined ? { aim: params.aim } : {}),
    ...(params.team !== undefined ? { team: params.team } : {}),
    ...(params.hit !== undefined ? { hit: params.hit } : {}),
    ...(params.tags ? { tags: params.tags } : {}),
  });

  const rawPosition =
    typeof params.position === "function"
      ? params.position(ctx)
      : params.position;
  const basePosition = rawPosition
    ? new Vec2(rawPosition.x, rawPosition.y)
    : resolveAbilityTransform(ctx, "spawn").worldPosition;
  const position = params.offset
    ? basePosition.add(
        new Vec2(params.offset.x, params.offset.y).rotate(resolved.aim.angle()),
      )
    : basePosition;
  const context: AbilitySpawnContext<AbilitySpawnParams<TClass>> = {
    caster: resolved.caster,
    aim: resolved.aim,
    position,
    params: params.params,
    ...(resolved.team !== undefined ? { team: resolved.team } : {}),
    ...(resolved.delivery ? { delivery: resolved.delivery } : {}),
    activation: ctx.activation,
  };

  if (params.acquire) {
    ctx.entity.scene.context
      .resolve(ErrorBoundaryKey)
      .wrapCallback(() => params.acquire!(context, ctx), {
        kind: "Ability spawn acquire callback",
        entity: ctx.entity.name,
        scene: ctx.entity.scene.name,
        event: "spawn",
      });
  } else {
    // The public params inference checks setup's context shape; restore it at dispatch.
    const EntityClass = params.entity as new () => Entity & {
      setup(context: AbilitySpawnContext<AbilitySpawnParams<TClass>>): void;
    };
    ctx.entity.scene.spawn(EntityClass, context);
  }
}
