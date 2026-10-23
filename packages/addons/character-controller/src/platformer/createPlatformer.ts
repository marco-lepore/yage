import type { MotionResolver } from "../core/MotionIntent.js";
import { Transform } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import type { Component, Entity } from "@yagejs/core";
import {
  ColliderComponent,
  PhysicsWorldKey,
  RigidBodyComponent,
} from "@yagejs/physics";
import { defaultPlatformerTuning } from "./defaults.js";
import type { PlatformerConfig } from "./defaults.js";
import { CrushProbe } from "./CrushProbe.js";
import { GroundProbe } from "./GroundProbe.js";
import { MotionReconciler } from "./MotionReconciler.js";
import { MoveAdmission } from "./MoveAdmission.js";
import type { MoveAdmissionPolicies } from "./MoveAdmission.js";
import { PlatformerController } from "./PlatformerController.js";
import { PlatformerMoves } from "./PlatformerMoves.js";
import { Stance } from "./Stance.js";
import { TerrainAssist } from "./TerrainAssist.js";
import { WallProbe } from "./WallProbe.js";
import { PlatformerInput } from "./input.js";
import type { InputBinding } from "./input.js";

export interface CreatePlatformerOptions {
  readonly tuning?: Partial<PlatformerConfig>;
  /** Omit for keyboard/gamepad and pointer zones; null gives manual control. */
  readonly input?: InputBinding | null;
  /** Collision layer membership of the created collider. */
  readonly layers?: number;
  /** Collision layers the created collider interacts with. */
  readonly mask?: number;
  readonly admissionPolicies?: MoveAdmissionPolicies;
  /** Replace the headless arbitration model; defaults to `resolveMotion`. */
  readonly resolveMotion?: MotionResolver;
  /** Slope, step, and ground-snap assistance. Default true. */
  readonly terrain?: boolean;
  /** Report `PlatformerCrushedEvent` when a moving box pushes the body into a wall. Default false. */
  readonly crush?: boolean;
  readonly dash?: boolean;
  readonly wallJump?: boolean;
  readonly slide?: boolean;
  /** Down plus jump on a one-way platform drops through it. Default true. */
  readonly dropThrough?: boolean;
}

/** The components `createPlatformer` added, for reading state and custom moves. */
export interface PlatformerCharacter {
  readonly body: RigidBodyComponent;
  readonly collider: ColliderComponent;
  readonly input: PlatformerInput;
  readonly controller: PlatformerController;
  readonly admission: MoveAdmission;
  readonly moves: PlatformerMoves;
  readonly motion: MotionReconciler;
  readonly ground: GroundProbe;
  readonly wall: WallProbe;
  readonly stance: Stance;
}

/**
 * Turn an entity with a Transform into a feet-origin dynamic platformer
 * character. Creates the body and a box collider from `tuning.bodyWidth` and
 * `tuning.bodyHeight`, or uses the entity's existing body and collider: a
 * dynamic body with gravityScale 0 and fixed rotation, and one box whose
 * bottom edge sits on the origin. Every input is validated before the entity
 * changes.
 */
export function createPlatformer(
  entity: Entity,
  options: CreatePlatformerOptions = {},
): PlatformerCharacter {
  if (entity.tryGet(MotionReconciler))
    throw new Error("createPlatformer: the entity is already a character");
  const existingBody = entity.tryGet(RigidBodyComponent);
  const existingCollider = entity.tryGet(ColliderComponent);
  let size: Partial<PlatformerConfig> = {};
  if (existingBody || existingCollider) {
    if (!existingBody || !existingCollider)
      throw new Error(
        "createPlatformer: an existing body needs both a RigidBodyComponent and a ColliderComponent",
      );
    for (const name of ["layers", "mask"] as const)
      if (options[name] !== undefined)
        throw new Error(
          `createPlatformer: ${name} configures a created collider; set it on the existing ColliderComponent`,
        );
    for (const name of ["bodyWidth", "bodyHeight"] as const)
      if (options.tuning?.[name] !== undefined)
        throw new Error(
          `createPlatformer: ${name} comes from the existing collider; remove it from tuning`,
        );
    size = existingBox(existingBody, existingCollider);
  }
  const tuning = defaultPlatformerTuning({ ...options.tuning, ...size });

  const transform = entity.get(Transform);
  if (
    transform.worldRotation !== 0 ||
    transform.worldScale.x !== 1 ||
    transform.worldScale.y !== 1
  )
    throw new Error(
      "createPlatformer: require an upright Transform with world scale 1; scale or flip a visual child instead",
    );
  if (
    options.input !== null &&
    !entity.scene.context.tryResolve(InputManagerKey)
  )
    throw new Error(
      "createPlatformer: install InputPlugin or pass input: null",
    );
  if (!entity.scene.tryResolveScoped(PhysicsWorldKey))
    throw new Error(
      "createPlatformer: install PhysicsPlugin before spawning characters",
    );

  // Every constructor validates its own numbers, so nothing is added to the
  // entity until all of them have succeeded.
  const ground = new GroundProbe({
    tuning: {
      width: tuning.bodyWidth - 2 * tuning.groundProbeInset,
      distance: tuning.groundProbeDistance,
      ...(options.terrain === false
        ? {}
        : {
            snapDistance: tuning.groundSnapDistance,
            maxSlopeAngle: tuning.maxSlopeAngle,
          }),
    },
  });
  const stance = new Stance({
    tuning: { crouchedHeight: tuning.crouchHeight },
  });
  const wall = new WallProbe({
    tuning: {
      halfWidth: tuning.bodyWidth / 2,
      height: tuning.wallProbeHeight,
      centreY: tuning.wallProbeCentreY,
      distance: tuning.wallProbeDistance,
    },
  });
  const terrain =
    options.terrain === false
      ? undefined
      : new TerrainAssist({ ground, tuning });
  const motion = new MotionReconciler(terrain, options.resolveMotion);
  const input = new PlatformerInput(options.input);
  const controller = new PlatformerController({
    motion,
    ground,
    stance,
    wall,
    input,
    tuning,
  });
  const admission = new MoveAdmission({
    controller,
    stance,
    motion,
    tuning,
    ...(options.admissionPolicies
      ? { policies: options.admissionPolicies }
      : {}),
  });
  const moves = new PlatformerMoves({
    motion,
    controller,
    admission,
    tuning,
    ...(options.dash !== undefined ? { dash: options.dash } : {}),
    ...(options.wallJump !== undefined ? { wallJump: options.wallJump } : {}),
    ...(options.slide !== undefined ? { slide: options.slide } : {}),
    ...(options.dropThrough !== undefined
      ? { dropThrough: options.dropThrough }
      : {}),
  });

  const body =
    existingBody ??
    entity.add(
      new RigidBodyComponent({
        type: "dynamic",
        gravityScale: 0,
        fixedRotation: true,
        ccd: true,
      }),
    );
  const collider =
    existingCollider ??
    entity.add(
      new ColliderComponent({
        shape: {
          type: "box",
          width: tuning.bodyWidth,
          height: tuning.bodyHeight,
        },
        offset: { x: 0, y: -tuning.bodyHeight / 2 },
        friction: 0,
        restitution: 0,
        ...(options.layers !== undefined ? { layers: options.layers } : {}),
        ...(options.mask !== undefined ? { mask: options.mask } : {}),
      }),
    );
  // Each component's static updatePriority orders the fixed step. The add
  // order matters only for PlatformerInput, which finds PlatformerMoves when
  // it is added.
  const components: Component[] = [
    ground,
    stance,
    wall,
    ...(terrain ? [terrain] : []),
    controller,
    admission,
    moves,
    input,
    motion,
    ...(options.crush ? [new CrushProbe()] : []),
  ];
  for (const component of components) entity.add(component);
  return {
    body,
    collider,
    input,
    controller,
    admission,
    moves,
    motion,
    ground,
    wall,
    stance,
  };
}

/** The size of a valid existing character collider, or an error naming the mismatch. */
function existingBox(
  body: RigidBodyComponent,
  collider: ColliderComponent,
): { bodyWidth: number; bodyHeight: number } {
  if (
    body.type !== "dynamic" ||
    body.gravityScale !== 0 ||
    !body.rotationsLocked
  )
    throw new Error(
      "createPlatformer: an existing body must be dynamic with gravityScale 0 and fixed rotation",
    );
  const shape = collider.config.shape;
  if (
    shape?.type !== "box" ||
    collider.colliderCount > 1 ||
    (collider.config.offset?.x ?? 0) !== 0 ||
    collider.config.offset?.y !== -shape.height / 2
  )
    throw new Error(
      "createPlatformer: an existing collider must be one box with offset { x: 0, y: -height / 2 }",
    );
  return { bodyWidth: shape.width, bodyHeight: shape.height };
}
