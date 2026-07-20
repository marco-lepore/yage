import type { AbilitySpawnedClass } from "../core/AbilitySpawned.js";
import { createHitDelivery } from "../core/hit/delivery.js";
import type { HitDelivery, HitDeliveryOptions } from "../core/hit/delivery.js";
import type { Hit, StandardHitData } from "../core/hit/types.js";
import type { HitStage } from "../core/hit/resolve.js";
import type { PointStep, WindowStep } from "../core/types.js";
import { HitReceiver } from "./HitReceiver.js";
import type { GuardParams, HitReceiverOptions } from "./HitReceiver.js";
import { createReportingDelivery } from "./reportedDelivery.js";
import type { DeliveryProvenance } from "./reportedDelivery.js";
import { guard as createGuardStep } from "./steps/guard.js";
import type { GuardStepArgs } from "./steps/guard.js";
import { hitbox as createHitboxStep } from "./steps/hitbox.js";
import type { HitboxParams, HitboxStepArgs } from "./steps/hitbox.js";
import { spawn as createSpawnStep } from "./steps/spawn.js";
import type { SpawnParams, SpawnStepArgs } from "./steps/spawn.js";

/** Runtime proof that an unknown event or trait payload uses `TData`. */
export type HitDataPredicate<TData = StandardHitData> = (
  data: unknown,
) => data is TData;

export interface CreateHitToolsOptions<TData = StandardHitData> {
  /** Narrows data carried across the global `Hittable` and hit-event boundaries. */
  isData: HitDataPredicate<TData>;
}

/** Existing hit primitives with one game's data vocabulary pinned once. */
export interface HitTools<TData = StandardHitData> {
  readonly hitbox: (
    args: HitboxStepArgs<TData>,
  ) => WindowStep<HitboxParams<TData>>;
  readonly guard: (
    args: GuardStepArgs<TData>,
  ) => WindowStep<GuardParams<TData>>;
  readonly spawn: <TClass extends AbilitySpawnedClass>(
    args: SpawnStepArgs<TClass, TData>,
  ) => PointStep<SpawnParams<TClass, TData>>;
  readonly delivery: (options: HitDeliveryOptions<TData>) => HitDelivery;
  readonly reportingDelivery: (
    options: HitDeliveryOptions<TData>,
    provenance?: DeliveryProvenance,
  ) => HitDelivery;
  readonly receiver: (
    options?: HitReceiverOptions<TData>,
  ) => HitReceiver<TData>;
  readonly stage: (
    stage: HitStage<TData, HitReceiver<TData>>,
  ) => HitStage<TData, HitReceiver<TData>>;
  readonly isData: HitDataPredicate<TData>;
  readonly isHit: (hit: Hit<unknown>) => hit is Hit<TData>;
}

/** Pin the hit-data type shared by raw hit primitives and boundary guards. */
export function createHitTools<TData = StandardHitData>(
  options: CreateHitToolsOptions<TData>,
): HitTools<TData> {
  const { isData } = options;
  return {
    hitbox: (args) => createHitboxStep<TData>(args),
    guard: (args) => createGuardStep<TData>(args),
    spawn: <TClass extends AbilitySpawnedClass>(
      args: SpawnStepArgs<TClass, TData>,
    ) => createSpawnStep<TClass, TData>(args),
    delivery: (deliveryOptions) => createHitDelivery<TData>(deliveryOptions),
    reportingDelivery: (deliveryOptions, provenance) =>
      createReportingDelivery<TData>(deliveryOptions, provenance),
    receiver: (receiverOptions = {}) => new HitReceiver<TData>(receiverOptions),
    stage: (stage) => stage,
    isData,
    isHit: (hit): hit is Hit<TData> => isData(hit.data),
  };
}
