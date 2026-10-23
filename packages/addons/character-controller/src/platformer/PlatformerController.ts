import { finite, tuningNumbers } from "../core/validate.js";
import { Component, defineEvent } from "@yagejs/core";

import type { GroundProbe } from "./GroundProbe.js";
import { CHARACTER_CONTROLLER_PRIORITY } from "../core/MotionIntent.js";
import type { MotionReconciler } from "./MotionReconciler.js";
import type { PlatformerInput } from "./input.js";
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

/**
 * Classifies ground contact, settles the stance, and submits running,
 * gravity, and wall-slide intents at priority 0 each fixed step. Reads held
 * direction and crouch from `PlatformerInput`.
 */
export class PlatformerController extends Component {
  static override updatePriority = -20;

  private readonly motion: MotionReconciler;
  private readonly ground: GroundProbe;
  private readonly stance: Stance;
  private readonly wall: WallProbe;
  private readonly input: PlatformerInput;
  private readonly tuning: PlatformerTuning;

  private _speedScale = 1;
  /** Whether falling against a held-toward wall slides at `wallSlideSpeed`. */
  wallClingEnabled = true;

  private _mode: PlatformerMode = "airborne";
  private _direction = 0;
  private _down = false;
  private _facing: 1 | -1 = 1;
  private _blocked = false;
  private _crouchBegan = false;
  private _wallSide: -1 | 0 | 1 = 0;

  constructor(params: {
    motion: MotionReconciler;
    ground: GroundProbe;
    stance: Stance;
    wall: WallProbe;
    input: PlatformerInput;
    tuning: PlatformerTuning;
  }) {
    super();
    this.motion = params.motion;
    this.ground = params.ground;
    this.stance = params.stance;
    this.wall = params.wall;
    this.input = params.input;
    tuningNumbers("PlatformerController", params.tuning);
    this.tuning = Object.freeze({ ...params.tuning });
  }

  /** Multiplies run speed, for water, slowing effects, or carried weight. Default 1. */
  get speedScale(): number {
    return this._speedScale;
  }
  set speedScale(scale: number) {
    finite("PlatformerController.speedScale", "speedScale", scale, 0);
    this._speedScale = scale;
  }

  get grounded(): boolean {
    return this._mode === "grounded";
  }

  /** Grounded on a support configured as a one-way platform. */
  get onOneWay(): boolean {
    return this.grounded && this.ground.supportOneWay;
  }

  /** The held direction read this step, -1 through 1. */
  get direction(): number {
    return this._direction;
  }

  /** Whether down was held this step. */
  get down(): boolean {
    return this._down;
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

  /** Airborne and falling against a wall the player holds toward. Read it for a wall-slide animation. */
  get clinging(): boolean {
    return (
      this.wallClingEnabled &&
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
    if (dt <= 0) return;
    // The direction and the crouch are read as held state, so they answer the
    // same whatever number of fixed steps a frame carries.
    this._direction = this.input.direction;
    this._down = this.input.down;
    if (this._direction !== 0) this._facing = this._direction > 0 ? 1 : -1;

    // A body moving away from its support faster than groundedRiseTolerance
    // is airborne even while the probe still reports ground, as it does for a
    // step or two after a jump. Counting those steps as ground would cancel
    // the jump with the ground press and restore a spent air jump. The
    // tolerance keeps a resting body grounded: the solver pushes it out of
    // the floor every step, so its vertical speed crosses zero constantly.
    // The last supported normal tells travel over a crest from a takeoff.
    // The body's velocity is measured against the support velocity it was
    // built on. On an update that runs no physics step the body already holds
    // its next velocity while the support still reports its last step, so
    // the support's own reading would count a turning platform as departure.
    const normal = this.grounded ? this.supportNormal : this.ground.normal;
    const currentNormal = this.ground.normal;
    const supportVelocity =
      this.motion.appliedSupportVelocity(this.ground.support) ??
      this.ground.actualSupportVelocity;
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
    if (this._down && (mode === "grounded" || wasCrouched))
      this.stance.crouch();
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
        allowStep: !this.stance.crouched,
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
      frame: "surface",
      axis: "y",
      target: this.tuning.groundPressSpeed,
      acceleration: Infinity,
      priority: CHARACTER_CONTROLLER_PRIORITY,
    });
  }

  private submitAirborne(): void {
    this.submitSteering(this.tuning.airAcceleration, this.tuning.airShed);
    this.motion.submit({
      source: SOURCE,
      frame: "world",
      axis: "y",
      target: this.clinging
        ? this.tuning.wallSlideSpeed
        : this.tuning.terminalFallSpeed,
      acceleration: this.tuning.gravity * this.gravityMultiplier(),
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
      frame: "surface",
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
      target: this._direction * this.tuning.runSpeed * this._speedScale,
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
