export {
  Abilities,
  AbilityEnded,
  AbilityPhaseChanged,
  AbilityStarted,
} from "./core/Abilities.js";
export type { AbilitiesOptions } from "./core/Abilities.js";
export { defineStep } from "./core/defineStep.js";
export {
  AbilitySpawned,
  resolveAbilitySource,
  resolveAbilityTeam,
} from "./core/AbilitySpawned.js";
export type {
  AbilitySpawnContext,
  AbilitySpawnedClass,
  AbilitySpawnedEntity,
  AbilitySpawnParams,
} from "./core/AbilitySpawned.js";
export type {
  AbilityActivation,
  AbilityCanSendOptions,
  AbilityDef,
  AbilityMatcher,
  AbilitySendOptions,
  AbilityReleaseOptions,
  AbilityStep,
  CancelWindow,
  PhaseDef,
  PhaseTransition,
  AbsolutePhaseTransition,
  RelativePhaseTransition,
  PhasedAbilityDef,
  PlayRejection,
  PlayResult,
  PointStep,
  PointStepHooks,
  StepContext,
  TimelineAbilityDef,
  WindowStep,
  WindowStepHooks,
} from "./core/types.js";
export { resolveScalar } from "./core/scalar.js";
export type { Scalar } from "./core/scalar.js";

export { Hittable } from "./core/hit/types.js";
export type {
  Hit,
  HitOutcomes,
  HitResult,
  StandardHitData,
} from "./core/hit/types.js";
export {
  createHitDelivery,
  resolveHitSpec,
  shouldConsumeProjectile,
} from "./core/hit/delivery.js";
export type {
  DeliveryColliderGroups,
  HitDelivery,
  HitDeliveryOptions,
  HitSpec,
} from "./core/hit/delivery.js";
export { resolveHit } from "./core/hit/resolve.js";
export type { HitStage } from "./core/hit/resolve.js";

export {
  HitGuarded,
  HitReceived,
  HitReceiver,
} from "./components/HitReceiver.js";
export type {
  GuardParams,
  GuardOutcome,
  GuardPolicy,
  HitFilter,
  HitReceivedPayload,
  HitReceiverOptions,
} from "./components/HitReceiver.js";
export { createHitTools } from "./components/createHitTools.js";
export type {
  CreateHitToolsOptions,
  HitDataPredicate,
  HitTools,
} from "./components/createHitTools.js";
export {
  Health,
  HealthDamaged,
  HealthDied,
  HealthHealed,
} from "./components/Health.js";
export { Stagger } from "./components/Stagger.js";
export {
  damageStep,
  defaultHitSteps,
  reactionStep,
} from "./components/standardHit.js";
export { Facing } from "./components/Facing.js";
export type { Cardinal } from "./components/Facing.js";
export {
  HitDealt,
  createReportingDelivery,
} from "./components/reportedDelivery.js";
export type {
  DeliveryProvenance,
  HitDealtPayload,
} from "./components/reportedDelivery.js";
export { aimAt, resolveAim } from "./components/aim.js";
export type { Aim } from "./components/aim.js";
export { anim } from "./components/steps/anim.js";
export { block, guard, parry } from "./components/steps/guard.js";
export type { GuardStepArgs } from "./components/steps/guard.js";
export { invulnerable } from "./components/steps/invulnerable.js";
export { slowmo } from "./components/steps/slowmo.js";
export type {
  SlowmoParams,
  SlowmoWindowArgs,
  TimedSlowmoArgs,
} from "./components/steps/slowmo.js";
export {
  REACTION_PRIORITY,
  staggerMotion,
  staggerReaction,
} from "./components/steps/stagger.js";

export { Projectile } from "./entities/Projectile.js";
export type { ProjectileConfig } from "./entities/Projectile.js";
export { hitbox } from "./components/steps/hitbox.js";
export type {
  HitboxParams,
  HitboxStepArgs,
} from "./components/steps/hitbox.js";
export { spawn } from "./components/steps/spawn.js";
export type {
  SpawnParams,
  SpawnPosition,
  SpawnStepArgs,
} from "./components/steps/spawn.js";
export { TouchDamage } from "./components/TouchDamage.js";
export type { TouchDamageOptions } from "./components/TouchDamage.js";
