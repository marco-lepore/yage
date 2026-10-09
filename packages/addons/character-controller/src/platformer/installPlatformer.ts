import type { MotionResolver } from "../core/MotionIntent.js";
import { count, interactionGroup, tuningNumbers } from "../core/validate.js";
import { Component, type Entity } from "@yagejs/core";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import { GroundProbe } from "./GroundProbe.js";
import { Stance } from "./Stance.js";
import { WallProbe } from "./WallProbe.js";
import { TerrainAssist } from "./TerrainAssist.js";
import { MotionReconciler } from "./MotionReconciler.js";
import { PlatformerController } from "./PlatformerController.js";
import { MoveAdmission, type MoveAdmissionTuning } from "./MoveAdmission.js";
import type { MoveAdmissionPolicies } from "./MoveAdmission.js";
import { CrushProbe } from "./CrushProbe.js";
import type { PlatformerTuning } from "./PlatformerTuning.js";
import type {
  PlatformerDemand,
  SpeedLimitView,
  FallHoldView,
} from "./controllerViews.js";

type TerrainNumbers = ConstructorParameters<typeof TerrainAssist>[0]["tuning"];
export interface PlatformerSetup {
  /** Replace headless arbitration; defaults to the shared resolveMotion model. */
  resolveMotion?: MotionResolver;
  tuning: PlatformerTuning &
    TerrainNumbers & {
      bodyWidth: number;
      groundProbeInset: number;
      groundProbeDistance: number;
      crouchHeight: number;
      wallProbeHeight: number;
      wallProbeCentreY: number;
      wallProbeDistance: number;
      maxSlopeAngle: number;
    };
  collision: { solid: number; volume: number; wall: number };
  /** Full-shape ground sensing and slope/step correction. Default true. */
  terrain?: boolean;
  /** Install crush sensing after the reconciler. Default false. */
  crush?: boolean;
  /** Omit for actors with no jump/dash admission. */
  admission?: MoveAdmissionTuning;
  admissionPolicies?: MoveAdmissionPolicies;
}

/** A forgotten finish fails on the first simulation step instead of leaving a dormant body. */
class InstallationGuard extends Component {
  complete = false;
  fixedUpdate(): void {
    if (!this.complete)
      throw new Error(
        "Platformer installation requires startController() and finish() during entity setup",
      );
    this.enabled = false;
  }
}

/** Staged composition keeps consumer input and move producers in the same fixed-step order. */
export class PlatformerInstallation {
  readonly ground: GroundProbe;
  readonly stance: Stance;
  readonly wall: WallProbe;
  readonly motion: MotionReconciler;
  private readonly guard: InstallationGuard;
  private controller?: PlatformerController;
  private moveAdmission?: MoveAdmission;

  constructor(
    private readonly entity: Entity,
    private readonly setup: PlatformerSetup,
  ) {
    tuningNumbers("installPlatformer", setup.tuning);
    for (const [name, value] of Object.entries(setup.collision))
      interactionGroup("installPlatformer collision", name, value);
    if (setup.admission) {
      tuningNumbers("installPlatformer admission", setup.admission);
      count(
        "installPlatformer admission",
        "airJumps",
        setup.admission.airJumps,
      );
      count(
        "installPlatformer admission",
        "airDashes",
        setup.admission.airDashes,
      );
    }
    const body = entity.get(RigidBodyComponent);
    const collider = entity.get(ColliderComponent);
    const shape = collider.config.shape;
    if (body.type !== "dynamic" || body.gravityScale !== 0)
      throw new Error(
        "installPlatformer: require a dynamic body with gravityScale 0",
      );
    if (
      shape?.type !== "box" ||
      shape.width <= 4 ||
      shape.height <= setup.tuning.crouchHeight ||
      setup.tuning.crouchHeight <= 0 ||
      collider.colliderCount !== 1 ||
      (collider.config.offset?.x ?? 0) !== 0 ||
      collider.config.offset?.y !== -shape.height / 2
    )
      throw new Error(
        "installPlatformer: require one feet-origin box with width > 4 and 0 < crouchHeight < height",
      );
    if (
      setup.tuning.bodyWidth !== shape.width ||
      setup.tuning.bodyWidth <= 2 * setup.tuning.groundProbeInset ||
      setup.tuning.maxSlopeAngle >= 90
    )
      throw new Error(
        "installPlatformer: bodyWidth must match the collider, groundProbeInset must leave positive width, and maxSlopeAngle must be < 90",
      );
    this.setup = {
      ...setup,
      tuning: Object.freeze({ ...setup.tuning }),
      collision: { ...setup.collision },
      ...(setup.admission
        ? { admission: Object.freeze({ ...setup.admission }) }
        : {}),
    };
    if (entity.tryGet(GroundProbe) || entity.tryGet(MotionReconciler))
      throw new Error(
        "Platformer installation requires an actor without existing motion components",
      );
    const { tuning: t, collision: c } = setup;
    this.guard = entity.add(new InstallationGuard());
    this.ground = entity.add(
      new GroundProbe({
        tuning: {
          width: t.bodyWidth - 2 * t.groundProbeInset,
          distance: t.groundProbeDistance,
          filterGroups: c.solid,
          ...(setup.terrain === false
            ? {}
            : {
                snapDistance: t.groundSnapDistance,
                maxSlopeAngle: t.maxSlopeAngle,
              }),
        },
      }),
    );
    this.stance = entity.add(
      new Stance({
        tuning: { crouchedHeight: t.crouchHeight, filterGroups: c.volume },
      }),
    );
    this.wall = entity.add(
      new WallProbe({
        tuning: {
          halfWidth: t.bodyWidth / 2,
          height: t.wallProbeHeight,
          centreY: t.wallProbeCentreY,
          distance: t.wallProbeDistance,
          filterGroups: c.wall,
        },
      }),
    );
    const terrain =
      setup.terrain === false
        ? undefined
        : entity.add(
            new TerrainAssist({
              ground: this.ground,
              tuning: t,
              solid: c.solid,
              volume: c.volume,
            }),
          );
    this.motion = new MotionReconciler(terrain, setup.resolveMotion);
  }

  /** Call after adding components that supply demand, limiting or fall suspension. */
  startController(params: {
    demand: PlatformerDemand;
    limit?: SpeedLimitView;
    fall?: FallHoldView;
  }): PlatformerController {
    if (this.controller)
      throw new Error("Platformer controller already installed");
    this.controller = this.entity.add(
      new PlatformerController({
        motion: this.motion,
        ground: this.ground,
        stance: this.stance,
        wall: this.wall,
        tuning: this.setup.tuning,
        demand: params.demand,
        limit: params.limit ?? { speedScale: 1 },
        fall: params.fall ?? { holdingFall: false, fallHoldRate: 0 },
      }),
    );
    if (this.setup.admission)
      this.moveAdmission = this.entity.add(
        new MoveAdmission({
          controller: this.controller,
          stance: this.stance,
          motion: this.motion,
          tuning: this.setup.admission,
          ...(this.setup.admissionPolicies
            ? { policies: this.setup.admissionPolicies }
            : {}),
        }),
      );
    return this.controller;
  }

  get admission(): MoveAdmission {
    if (!this.moveAdmission)
      throw new Error(
        "Configure admission tuning and start the controller before reading admission",
      );
    return this.moveAdmission;
  }

  /** Call after all fixed-step motion producers, before presentation components. */
  finish(): void {
    if (!this.controller)
      throw new Error(
        "Start the platformer controller before finishing installation",
      );
    if (this.guard.complete)
      throw new Error("Platformer installation already finished");
    this.entity.add(this.motion);
    if (this.setup.crush)
      this.entity.add(new CrushProbe(this.setup.collision.volume));
    this.guard.complete = true;
  }
}

/** Requires an existing feet-origin body and collider; their material and masks remain consumer-owned. */
export function installPlatformer(
  entity: Entity,
  setup: PlatformerSetup,
): PlatformerInstallation {
  return new PlatformerInstallation(entity, setup);
}
