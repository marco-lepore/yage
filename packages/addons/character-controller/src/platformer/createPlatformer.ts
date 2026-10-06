import type { MotionResolver } from "../core/MotionIntent.js";
import type { InputManager } from "@yagejs/input";
import { finite } from "../core/validate.js";
import { ServiceKey, Transform } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import {
  ColliderComponent,
  PhysicsWorldKey,
  RigidBodyComponent,
} from "@yagejs/physics";
import { defaultPlatformerTuning } from "./defaults.js";
import type { PlatformerConfig } from "./defaults.js";
import { installPlatformer } from "./installPlatformer.js";
import type { PlatformerSetup } from "./installPlatformer.js";
import { PlatformerMoves } from "./PlatformerMoves.js";
import { PlatformerInput } from "./input.js";
import type { InputBinding } from "./input.js";
import type { FallHoldView, SpeedLimitView } from "./controllerViews.js";
import type { MoveAdmissionPolicies } from "./MoveAdmission.js";

// @yagejs/input owns this id; the input peer is optional for manual characters.
const INPUT_KEY = new ServiceKey<InputManager>("inputManager");

export interface CreatePlatformerOptions {
  readonly admissionPolicies?: MoveAdmissionPolicies;
  readonly resolveMotion?: MotionResolver;
  readonly tuning?: Partial<PlatformerConfig>;
  /** Omit for keyboard/gamepad and pointer zones; null gives manual control. */
  readonly input?: InputBinding | null;
  /** Query groups. Include one-way platforms only in solid. Default all groups. */
  readonly collision?: Partial<PlatformerSetup["collision"]>;
  readonly collisionGroups?: number;
  readonly terrain?: boolean;
  readonly crush?: boolean;
  readonly dash?: boolean;
  readonly wallJump?: boolean;
  readonly slide?: boolean;
  readonly limit?: SpeedLimitView;
  readonly fall?: FallHoldView;
}

/**
 * Add a complete feet-origin dynamic character to an entity with a Transform.
 * Use installPlatformer for an existing body or custom movement producers.
 */
export function createPlatformer(
  entity: Entity,
  options: CreatePlatformerOptions = {},
) {
  const tuning = defaultPlatformerTuning(options.tuning);
  const transform = entity.get(Transform);
  if (
    transform.worldRotation !== 0 ||
    transform.worldScale.x !== 1 ||
    transform.worldScale.y !== 1
  )
    throw new Error(
      "createPlatformer: require an upright Transform with world scale 1; scale or flip a visual child instead",
    );
  if (options.input !== null && !entity.scene.context.tryResolve(INPUT_KEY))
    throw new Error(
      "createPlatformer: install InputPlugin or pass input: null",
    );
  for (const [name, group] of Object.entries({
    ...options.collision,
    collisionGroups: options.collisionGroups,
  })) {
    if (group === undefined) continue;
    finite("createPlatformer", name, group, 0);
    if (!Number.isInteger(group) || group > 0xffffffff)
      throw new Error(
        `createPlatformer: ${name} must be an unsigned 32-bit group, got ${group}`,
      );
  }
  if (!entity.scene._resolveScoped(PhysicsWorldKey))
    throw new Error(
      "createPlatformer: install PhysicsPlugin before spawning characters",
    );
  if (entity.tryGet(RigidBodyComponent) || entity.tryGet(ColliderComponent))
    throw new Error(
      "createPlatformer: entity already has a physics body; use installPlatformer for custom assembly",
    );
  const body = entity.add(
    new RigidBodyComponent({
      type: "dynamic",
      gravityScale: 0,
      fixedRotation: true,
      ccd: true,
    }),
  );
  const collider = entity.add(
    new ColliderComponent({
      shape: {
        type: "box",
        width: tuning.bodyWidth,
        height: tuning.bodyHeight,
      },
      offset: { x: 0, y: -tuning.bodyHeight / 2 },
      friction: 0,
      restitution: 0,
      ...(options.collisionGroups !== undefined
        ? {
            layers: options.collisionGroups >>> 16,
            mask: options.collisionGroups & 0xffff,
          }
        : {}),
    }),
  );
  const installation = installPlatformer(entity, {
    tuning,
    collision: {
      solid: 0xffffffff,
      volume: 0xffffffff,
      wall: 0xffffffff,
      ...options.collision,
    },
    admission: tuning,
    ...(options.admissionPolicies
      ? { admissionPolicies: options.admissionPolicies }
      : {}),
    ...(options.resolveMotion ? { resolveMotion: options.resolveMotion } : {}),
    ...(options.terrain !== undefined ? { terrain: options.terrain } : {}),
    ...(options.crush !== undefined ? { crush: options.crush } : {}),
  });
  const input = entity.add(new PlatformerInput(options.input));
  const controller = installation.startController({
    demand: input,
    ...(options.limit ? { limit: options.limit } : {}),
    ...(options.fall ? { fall: options.fall } : {}),
  });
  const moves = entity.add(
    new PlatformerMoves({
      motion: installation.motion,
      controller,
      admission: installation.admission,
      tuning,
      ...(options.dash !== undefined ? { dash: options.dash } : {}),
      ...(options.wallJump !== undefined ? { wallJump: options.wallJump } : {}),
      ...(options.slide !== undefined ? { slide: options.slide } : {}),
    }),
  );
  input.connect(moves);
  installation.finish();
  return {
    body,
    collider,
    input,
    controller,
    moves,
    motion: installation.motion,
    ground: installation.ground,
    wall: installation.wall,
    stance: installation.stance,
    admission: installation.admission,
  };
}

export type PlatformerCharacter = ReturnType<typeof createPlatformer>;
