import { finite, tuningNumbers } from "../core/validate.js";
import { Component, ErrorBoundaryKey, defineEvent } from "@yagejs/core";

import type { GroundProbe } from "./GroundProbe.js";
import { CHARACTER_CONTROLLER_PRIORITY } from "../core/MotionIntent.js";
import type {
  FallHoldView,
  PlatformerDemand,
  SpeedLimitView,
} from "./controllerViews.js";
import type { MotionReconciler } from "./MotionReconciler.js";
import type { PlatformerTuning } from "./PlatformerTuning.js";
import type { Stance } from "./Stance.js";
import type { WallProbe } from "./WallProbe.js";

/**
 * One name for all three of this controller's intents, so a refusal and the
 * tie error in `resolveMotion` name the component rather than which of its
 * rules happened to submit.
 */
const SOURCE = "controller";

/** Classified air-to-ground contact, after the initial spawn sample. */
export const PlatformerLandedEvent = defineEvent(
  "character-controller:platformer:landed",
);

export type PlatformerMode = "grounded" | "airborne";

export class PlatformerController extends Component {
  private readonly motion: MotionReconciler;
  private readonly ground: GroundProbe;
  private readonly stance: Stance;
  private readonly wall: WallProbe;
  private readonly tuning: PlatformerTuning;
  private readonly demand: PlatformerDemand;
  private readonly limit: SpeedLimitView;
  private readonly fall: FallHoldView;

  private speedScale = 1;
  private holdingFall = false;
  private fallHoldRate = 0;
  private wallClingAllowed = true;

  private _mode: PlatformerMode = "airborne";
  private _direction = 0;
  private _facing: 1 | -1 = 1;
  private _blocked = false;
  private _crouchBegan = false;
  private _wallSide: -1 | 0 | 1 = 0;

  constructor(params: {
    motion: MotionReconciler;
    ground: GroundProbe;
    stance: Stance;
    wall: WallProbe;
    demand: PlatformerDemand;
    limit: SpeedLimitView;
    fall: FallHoldView;
    tuning: PlatformerTuning;
  }) {
    super();
    this.motion = params.motion;
    this.ground = params.ground;
    this.stance = params.stance;
    this.wall = params.wall;
    this.demand = params.demand;
    this.limit = params.limit;
    this.fall = params.fall;
    tuningNumbers("PlatformerController", params.tuning);
    this.tuning = Object.freeze({ ...params.tuning });
  }

  get grounded(): boolean {
    return this._mode === "grounded";
  }

  get direction(): number {
    return this._direction;
  }

  /** The last direction actually asked for, held through a stop. */
  get facing(): 1 | -1 {
    return this._facing;
  }

  get blocked(): boolean {
    return this._blocked;
  }

  get wallSide(): -1 | 0 | 1 {
    return this._wallSide;
  }

  /** Airborne and falling against a wall the body is asking for. Shared with presentation. */
  get clinging(): boolean {
    return (
      this.wallClingAllowed &&
      !this.grounded &&
      this._wallSide !== 0 &&
      this.motion.velocityY > 0
    );
  }

  /**
   * Whether the crouch began on this step. Only the step the stance changes can
   * tell, because by the time anything else looks the body is simply crouched,
   * and "down pressed while running" is a transition rather than a state.
   */
  get crouchBegan(): boolean {
    return this._crouchBegan;
  }

  private sampledGround = false;
  private supportNormal = { x: 0, y: -1 };

  fixedUpdate(dt: number): void {
    finite("PlatformerController.fixedUpdate", "dt", dt, 0);
    if (dt <= 0) return;
    // The direction and the crouch are read as held state, so they answer the
    // same whatever number of fixed steps a frame carries.
    let down = false;
    const read = () => {
      const direction = this.demand.direction;
      const scale = this.limit.speedScale;
      const holding = this.fall.holdingFall;
      const rate = holding ? this.fall.fallHoldRate : 0;
      finite("PlatformerController", "direction", direction);
      if (Math.abs(direction) > 1)
        throw new Error(
          `PlatformerController: direction must be in [-1, 1], got ${direction}`,
        );
      finite("PlatformerController", "speedScale", scale, 0);
      finite("PlatformerController", "fallHoldRate", rate, 0);
      down = this.demand.down;
      this.wallClingAllowed = this.demand.wallClingAllowed !== false;
      this._direction = direction;
      this.speedScale = scale;
      this.holdingFall = holding;
      this.fallHoldRate = rate;
    };
    const boundary = this.context.tryResolve(ErrorBoundaryKey);
    if (boundary)
      boundary.wrapCallback(read, {
        kind: "Platformer movement policy",
        entity: this.entity.name,
        scene: this.scene.name,
      });
    else read();
    if (this._direction !== 0) this._facing = this._direction > 0 ? 1 : -1;

    // Standing on something while rising is not standing. A body that landed
    // fast is still sinking out of the floor when the next jump takes off, so
    // the probe keeps reporting ground for a step or two afterwards — long
    // enough for the ground press below to cancel the jump outright, and for
    // the landing to hand back a second jump that was already spent.
    //
    // The tolerance is what separates a jump from a body at rest. A resting
    // body is never quite still: the solver pushes it back out of the floor
    // every step, so its speed crosses zero constantly. Testing the sign alone
    // makes a standing player flicker between the two modes.
    // The last supported tangent distinguishes crest travel from takeoff.
    const normal = this.grounded ? this.supportNormal : this.ground.normal;
    const currentNormal = this.ground.normal;
    const supportVelocity = this.ground.actualSupportVelocity;
    const relativeX = this.motion.velocityX - supportVelocity.x;
    const relativeY = this.motion.velocityY - supportVelocity.y;
    const separating =
      relativeX * currentNormal.x + relativeY * currentNormal.y;
    const departure = this.ground.assisted
      ? Math.min(separating, relativeX * normal.x + relativeY * normal.y)
      : -relativeY;
    const rising = departure > this.tuning.groundedRiseTolerance;
    const supported =
      this.ground.grounded ||
      (this.ground.assisted && this.grounded && this.ground.nearSupport);
    const mode: PlatformerMode = supported && !rising ? "grounded" : "airborne";
    const landed =
      this.sampledGround && this._mode === "airborne" && mode === "grounded";
    this._mode = mode;
    this.motion.setSupport(
      this.grounded ? this.ground.support : undefined,
      this.ground.supportVelocity,
    );
    if (mode === "grounded") this.supportNormal = { ...this.ground.normal };
    this.sampledGround = true;
    if (landed) this.entity.emit(PlatformerLandedEvent);
    if (!this.effectiveEnabled || this.entity.isDestroyed) return;

    // Settled before steering, so this step's rates are the stance's. The
    // ground is needed to start a crouch; the key alone keeps one, so a jump
    // with down held stays low, and a crouched dash into a wall — which reads
    // as airborne for a step or two while the body is sunk into it — does not
    // stand the body up and drop it back. Standing waits for room, since a body
    // that stood up under a ceiling would be inside it.
    const wasCrouched = this.stance.crouched;
    const room = !wasCrouched || this.stance.canStand;
    if (down && (mode === "grounded" || wasCrouched)) this.stance.crouch();
    else if (wasCrouched && room) this.stance.stand();
    this._blocked = this.stance.crouched && !room;
    this._crouchBegan = !wasCrouched && this.stance.crouched;
    const wall = this.wall.side;
    this._wallSide =
      wall !== 0 && Math.sign(this._direction) === wall ? wall : 0;

    if (this.ground.assisted)
      this.motion.submitTerrain({
        grounded: this.grounded,
        direction: this._direction,
        allowStep: !this.stance.crouched && !this.holdingFall,
      });
    if (mode === "grounded") this.submitGrounded();
    else this.submitAirborne();
  }

  private submitGrounded(): void {
    if (this.stance.crouched) this.submitCrouched();
    else
      this.submitSteering(
        this.tuning.groundAcceleration,
        this.tuning.groundShed,
      );
    // A small downward press, so the solver keeps the body seated on the floor.
    this.motion.submit({
      source: SOURCE,
      frame: this.grounded ? "surface" : "world",
      axis: "y",
      target: this.tuning.groundPressSpeed,
      acceleration: Infinity,
      priority: CHARACTER_CONTROLLER_PRIORITY,
    });
  }

  private submitAirborne(): void {
    this.submitSteering(this.tuning.airAcceleration, this.tuning.airShed);
    const holding = this.holdingFall && this.motion.velocityY >= 0;
    this.motion.submit({
      source: SOURCE,
      frame: this.grounded ? "surface" : "world",
      axis: "y",
      target: holding
        ? 0
        : this.clinging
          ? this.tuning.wallSlideSpeed
          : this.tuning.terminalFallSpeed,
      acceleration: holding
        ? this.fallHoldRate
        : this.tuning.gravity * this.gravityMultiplier(),
      priority: CHARACTER_CONTROLLER_PRIORITY,
    });
  }

  private submitCrouched(): void {
    const speed = this.motion.ownVelocityX;
    const way = this._direction || Math.sign(speed) || this._facing;
    const target = this.blocked ? way * this.tuning.slideExitSpeed : 0;
    const cap = Math.max(this.tuning.slideSpeed, Math.abs(target));
    const fast = Math.abs(speed) > cap;
    this.motion.submit({
      source: SOURCE,
      frame: this.grounded ? "surface" : "world",
      axis: "x",
      target: fast ? Math.sign(speed) * cap : target,
      acceleration: fast ? Infinity : this.tuning.crouchAcceleration,
      priority: CHARACTER_CONTROLLER_PRIORITY,
    });
  }

  private submitSteering(acceleration: number, shed: number): void {
    this.motion.submit({
      source: SOURCE,
      frame: this.grounded ? "surface" : "world",
      axis: "x",
      target: this._direction * this.tuning.runSpeed * this.speedScale,
      acceleration,
      shed,
      priority: CHARACTER_CONTROLLER_PRIORITY,
    });
  }

  private gravityMultiplier(): number {
    const rate = this.motion.velocityY;
    if (Math.abs(rate) <= this.tuning.apexSpeed)
      return this.tuning.apexMultiplier;
    return rate < 0 ? this.tuning.riseMultiplier : this.tuning.fallMultiplier;
  }
}
