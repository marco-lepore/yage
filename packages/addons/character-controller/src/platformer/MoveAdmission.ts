import { count, finite, tuningNumbers } from "../core/validate.js";
import { Component, ErrorBoundaryKey } from "@yagejs/core";

import type { MotionReconciler } from "./MotionReconciler.js";
import type { PlatformerController } from "./PlatformerController.js";
import type { Stance } from "./Stance.js";

export type PlatformerMove =
  | "groundJump"
  | "airJump"
  | "wallJump"
  | "dropThrough"
  | "dash"
  | "slide";

export interface AirMoveCharges {
  readonly jumps: number;
  readonly dashes: number;
}

/** A detached snapshot; policy code cannot mutate admission through it. */
export interface MoveAdmissionState {
  readonly grounded: boolean;
  readonly onOneWay: boolean;
  readonly crouched: boolean;
  readonly blocked: boolean;
  readonly wallSide: -1 | 0 | 1;
  readonly airCharges: AirMoveCharges;
}

export interface MoveAdmissionPolicies {
  /** Additional game eligibility. Does not bypass contact, charge or cooldown rules. */
  readonly canStartMove?: (
    move: PlatformerMove,
    state: MoveAdmissionState,
  ) => boolean;
  /** Charges after ground contact, including spawn. Omit to use tuned counts. */
  readonly landingCharges?: (state: MoveAdmissionState) => AirMoveCharges;
}

/** The numbers admission takes. */
export interface MoveAdmissionTuning {
  /** How long after leaving a ledge a ground jump is still admitted, seconds. */
  readonly coyoteTime: number;
  /** How many jumps are available in the air before touching ground again. */
  readonly airJumps: number;
  /** How many dashes are available in the air before touching ground again. */
  readonly airDashes: number;
  /** How fast the body must already move the held way for down to start a slide, px/s. */
  readonly slideMinSpeed: number;
  /** How long the body must have been upright since the last slide before down starts another, seconds. */
  readonly slideRestTime: number;
  /** How long after leaving a wall a wall jump is still admitted, seconds. */
  readonly wallCoyoteTime: number;
}

export class MoveAdmission extends Component {
  private readonly controller: PlatformerController;
  private readonly stance: Stance;
  private readonly motion: MotionReconciler;
  private readonly tuning: MoveAdmissionTuning;
  private readonly policies: MoveAdmissionPolicies;

  private groundJumpSpent = true;
  private airJumpsLeft = 0;
  private airDashesLeft = 0;
  private _jumpsTaken = 0;
  private airborneFor = Infinity;
  private uprightFor = Infinity;
  private wasGrounded = false;
  private slideAdmitted = false;
  private offWallFor = Infinity;
  private wasOnWall = false;
  private wallJumpSpent = false;
  private _wallJumpSide: -1 | 0 | 1 = 0;

  constructor(params: {
    controller: PlatformerController;
    stance: Stance;
    motion: MotionReconciler;
    tuning: MoveAdmissionTuning;
    policies?: MoveAdmissionPolicies;
  }) {
    super();
    this.controller = params.controller;
    this.stance = params.stance;
    this.motion = params.motion;
    tuningNumbers("MoveAdmission", params.tuning);
    this.tuning = Object.freeze({ ...params.tuning });
    this.policies = { ...params.policies };
    count("MoveAdmission", "airJumps", this.tuning.airJumps);
    count("MoveAdmission", "airDashes", this.tuning.airDashes);
  }

  get airCharges(): AirMoveCharges {
    return { jumps: this.airJumpsLeft, dashes: this.airDashesLeft };
  }

  /** Set only supplied counts. Counts may exceed the tuned landing defaults. */
  setAirCharges(charges: Partial<AirMoveCharges>): void {
    const jumps = charges.jumps ?? this.airJumpsLeft;
    const dashes = charges.dashes ?? this.airDashesLeft;
    this.validateCharges("MoveAdmission.setAirCharges", { jumps, dashes });
    this.airJumpsLeft = jumps;
    this.airDashesLeft = dashes;
  }

  /** Restore tuned counts immediately; does not reset dash cooldown. */
  refillAirCharges(): void {
    this.setAirCharges({
      jumps: this.tuning.airJumps,
      dashes: this.tuning.airDashes,
    });
  }

  /**
   * How many jumps have begun. It only ever counts up, so a reader on the
   * rendered frame sees that one happened by the number changing, and cannot
   * miss one by looking on the wrong frame.
   */
  get jumpsTaken(): number {
    return this._jumpsTaken;
  }

  /** Actual airborne classification, without the coyote window used by jump admission. */
  get airborne(): boolean {
    return !this.controller.grounded;
  }

  get canGroundJump(): boolean {
    if (this.controller.blocked) return false;
    return (
      !this.groundJumpSpent &&
      (this.controller.grounded ||
        this.airborneFor <= this.tuning.coyoteTime) &&
      this.permits("groundJump")
    );
  }

  /** Dropping needs one-way support, but does not need standing headroom. */
  get canDropThrough(): boolean {
    return (
      !this.groundJumpSpent &&
      this.controller.onOneWay &&
      this.permits("dropThrough")
    );
  }

  /** Consume ground/coyote eligibility without counting a jump or starting physics drop-through. */
  spendDropThrough(): void {
    if (!this.canDropThrough)
      throw new Error(
        "MoveAdmission.spendDropThrough: no drop-through available",
      );
    this.groundJumpSpent = true;
  }

  /**
   * Record one departure authorized by a game-owned ledge hold. The caller
   * checks eligibility and calls once per departure. Increments jumpsTaken
   * and consumes ground/coyote and current wall-jump eligibility. No contact
   * or policy checks, motion, or events; air charges are unchanged.
   */
  recordLedgeJump(): void {
    this.groundJumpSpent = true;
    this.wallJumpSpent = true;
    this._jumpsTaken += 1;
  }

  /** Whether a jump in the air is admitted. Charges come back on landing. */
  get canAirJump(): boolean {
    if (this.controller.grounded || this.controller.blocked) return false;
    return this.airJumpsLeft > 0 && this.permits("airJump");
  }

  get canDash(): boolean {
    if (this.stance.crouched) return false;
    return (
      (this.controller.grounded || this.airDashesLeft > 0) &&
      this.permits("dash")
    );
  }

  get canSlide(): boolean {
    return this.slideAdmitted && this.permits("slide");
  }

  get canWallJump(): boolean {
    if (this.controller.grounded || this.controller.blocked) return false;
    if (this.wallJumpSpent) return false;
    return (
      this._wallJumpSide !== 0 &&
      this.offWallFor <= this.tuning.wallCoyoteTime &&
      this.permits("wallJump")
    );
  }

  /** Which side the wall that admitted the jump is on. -1 left, 1 right. */
  get wallJumpSide(): -1 | 0 | 1 {
    return this._wallJumpSide;
  }

  spendWallJump(): void {
    if (!this.canWallJump)
      throw new Error("MoveAdmission.spendWallJump: no wall jump available");
    this.wallJumpSpent = true;
    this._jumpsTaken += 1;
  }

  spendGroundJump(): void {
    if (!this.canGroundJump)
      throw new Error(
        "MoveAdmission.spendGroundJump: no ground jump available",
      );
    this.groundJumpSpent = true;
    this._jumpsTaken += 1;
  }

  spendAirJump(): void {
    if (!this.canAirJump)
      throw new Error("MoveAdmission.spendAirJump: no air jump available");
    this.airJumpsLeft -= 1;
    this._jumpsTaken += 1;
  }

  spendDash(): void {
    if (!this.canDash)
      throw new Error("MoveAdmission.spendDash: no dash available");
    if (!this.controller.grounded) this.airDashesLeft -= 1;
  }

  spendSlide(): void {
    if (!this.canSlide)
      throw new Error("MoveAdmission.spendSlide: no slide available");
    this.slideAdmitted = false;
    this.uprightFor = 0;
  }

  fixedUpdate(dt: number): void {
    finite("MoveAdmission.fixedUpdate", "dt", dt, 0);
    if (dt <= 0) return;
    const grounded = this.controller.grounded;
    // Landing is what restores the charges, so it is read as the transition
    // rather than as the state: a body that stays grounded refills once.
    if (grounded && !this.wasGrounded) {
      const charges = this.invoke("landingCharges", () => {
        const result = this.policies.landingCharges
          ? this.policies.landingCharges(this.state())
          : { jumps: this.tuning.airJumps, dashes: this.tuning.airDashes };
        const charges = { jumps: result?.jumps, dashes: result?.dashes };
        this.validateCharges("MoveAdmission.landingCharges", charges);
        return charges;
      });
      this.setAirCharges(charges);
      this.groundJumpSpent = false;
    }
    this.wasGrounded = grounded;
    this.airborneFor = grounded ? 0 : this.airborneFor + dt;

    // The rest counts time not crouched, in the air as well as on the ground,
    // and only a slide resets it, so a crouch that was not a slide costs
    // nothing but its stop.
    this.slideAdmitted =
      grounded &&
      this.controller.crouchBegan &&
      this.controller.direction * this.motion.ownVelocityX >=
        this.tuning.slideMinSpeed &&
      this.uprightFor >= this.tuning.slideRestTime;
    if (!this.stance.crouched) this.uprightFor += dt;

    // Reaching a wall is what buys a wall jump, so the latch clears on the step
    // contact begins and not on the step it ends. Ending it is the first thing
    // a wall jump does — the outward claim clears the probe's reach within one
    // step — so clearing on that would hand back the jump it just spent, and
    // the coyote window would be all that stood in the way of a second.
    //
    // The side is remembered rather than read at the press, so a jump taken
    // inside the coyote window leaves the wall the body actually touched.
    const side = this.controller.wallSide;
    if (side !== 0) {
      if (!this.wasOnWall) this.wallJumpSpent = false;
      this._wallJumpSide = side;
      this.offWallFor = 0;
    } else {
      this.offWallFor += dt;
    }
    this.wasOnWall = side !== 0;
  }

  private state(): MoveAdmissionState {
    return {
      grounded: this.controller.grounded,
      onOneWay: this.controller.onOneWay,
      crouched: this.stance.crouched,
      blocked: this.controller.blocked,
      wallSide: this._wallJumpSide,
      airCharges: this.airCharges,
    };
  }

  private permits(move: PlatformerMove): boolean {
    const policy = this.policies.canStartMove;
    if (!policy) return true;
    return this.invoke("canStartMove", () => {
      const result = policy(move, this.state());
      if (typeof result !== "boolean")
        throw new Error(
          `MoveAdmission.canStartMove: expected a boolean for ${move}, got ${String(result)}`,
        );
      return result;
    });
  }

  private validateCharges(context: string, charges: AirMoveCharges): void {
    for (const key of ["jumps", "dashes"] as const) {
      const value = charges?.[key];
      finite(context, key, value, 0);
      if (!Number.isSafeInteger(value))
        throw new Error(
          `${context}: ${key} must be a safe integer, got ${value}`,
        );
    }
  }

  private invoke<T>(name: string, read: () => T): T {
    const boundary = this.context.tryResolve(ErrorBoundaryKey);
    if (!boundary) return read();
    let result!: T;
    boundary.wrapCallback(
      () => {
        result = read();
      },
      {
        kind: `Platformer admission policy: ${name}`,
        entity: this.entity.name,
        scene: this.scene.name,
      },
    );
    return result;
  }
}
