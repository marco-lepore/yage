import { defineTrait } from "@yagejs/core";
import type { Entity, SetupParams, Vec2 } from "@yagejs/core";
import type { HitDelivery } from "./hit/delivery.js";

/** Values resolved when an ability spawns a game-owned attack entity. */
export interface AbilitySpawnContext<TParams = unknown> {
  /** Original ability caster, preserved through nested spawned attacks. */
  readonly caster: Entity;
  /** Unit firing direction resolved when the step fires. */
  readonly aim: Vec2;
  /** World position resolved from the running entity and facing-local offset. */
  readonly position: Vec2;
  /** Game-defined parameters paired with the spawned entity class. */
  readonly params: TParams;
  /** Explicit or inherited team, when one exists. */
  readonly team?: string;
  /** Ready reporting delivery when the step declares a hit. */
  readonly delivery?: HitDelivery;
}

/** Structural contract enforced by the `AbilitySpawned` trait. */
export interface AbilitySpawnedEntity<TParams = unknown> {
  /** The context supplied when the entity entered its scene. */
  readonly abilitySpawnContext: AbilitySpawnContext<TParams> | undefined;
  /** Configure the entity after it has been registered with its scene. */
  setup(context: AbilitySpawnContext<TParams>): void;
}

/** Entity constructor accepted by the typed ability `spawn` step. */
export type AbilitySpawnedClass = new () => Entity & AbilitySpawnedEntity;

/** Game-defined params inferred from an ability-spawned class's setup context. */
export type AbilitySpawnParams<TClass extends AbilitySpawnedClass> =
  SetupParams<InstanceType<TClass>> extends AbilitySpawnContext<infer TParams>
    ? TParams
    : never;

/** Marks an entity as accepting resolved ability-spawn context. */
export const AbilitySpawned =
  defineTrait<AbilitySpawnedEntity>("AbilitySpawned");

/** Resolve the original caster for a delivery running on a spawned attack. */
export function resolveAbilitySource(entity: Entity): Entity {
  if (!entity.hasTrait(AbilitySpawned)) return entity;
  return entity.abilitySpawnContext?.caster ?? entity;
}

/** Resolve the team retained by a spawned attack, when one was supplied. */
export function resolveAbilityTeam(entity: Entity): string | undefined {
  if (!entity.hasTrait(AbilitySpawned)) return undefined;
  return entity.abilitySpawnContext?.team;
}
