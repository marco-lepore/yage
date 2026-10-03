import { Component, defineEvent } from "@yagejs/core";
import type {
  DurableIntentHandle,
  MotionIntentHandle,
} from "../core/MotionIntent.js";
import { finite, tuningNumbers } from "../core/validate.js";
import type { MotionReconciler } from "./MotionReconciler.js";
import type { MoveAdmission } from "./MoveAdmission.js";
import type { PlatformerController } from "./PlatformerController.js";
import type { PlatformerMoveTuning } from "./defaults.js";

export const PlatformerJumpedEvent = defineEvent<{
  kind: "ground" | "air" | "wall";
}>("character-controller:platformer:jumped");
export const PlatformerDashedEvent = defineEvent<{ direction: -1 | 1 }>(
  "character-controller:platformer:dashed",
);
export const PlatformerSlidEvent = defineEvent(
  "character-controller:platformer:slid",
);

export interface PlatformerMoveOptions {
  readonly motion: MotionReconciler;
  readonly controller: PlatformerController;
  readonly admission: MoveAdmission;
  readonly tuning: PlatformerMoveTuning & { readonly slideSpeed: number };
  /** Higher numbers outrank continuous movement (priority 0). Default 10. */
  readonly priority?: number;
  readonly dash?: boolean;
  readonly wallJump?: boolean;
  readonly slide?: boolean;
}

/** Buffered standard moves. Every movement goes through the shared reconciler. */
export class PlatformerMoves extends Component {
  private jumpBuffer = -1;
  private dashBuffer = -1;
  private heldJump = false;
  private holdLeft = 0;
  private cooldown = 0;
  private dashLeft = 0;
  private wallLeft = 0;
  private holds: DurableIntentHandle[] = [];
  private commands: MotionIntentHandle[] = [];
  private readonly priority: number;
  private readonly tuning: PlatformerMoveOptions["tuning"];

  constructor(private readonly options: PlatformerMoveOptions) {
    super();
    this.tuning = Object.freeze({ ...options.tuning });
    tuningNumbers("PlatformerMoves", this.tuning);
    this.priority = options.priority ?? 10;
    finite("PlatformerMoves", "priority", this.priority, Number.MIN_VALUE);
  }

  get dashing(): boolean {
    return this.dashLeft > 0;
  }
  get wallJumping(): boolean {
    return this.wallLeft > 0;
  }
  get dashReady(): boolean {
    return (
      this.effectiveEnabled &&
      this.options.dash !== false &&
      !this.options.motion.solverOwned &&
      this.cooldown <= 0 &&
      this.options.admission.canDash
    );
  }

  /** Queue a press for the next advancing step, including through a freeze. */
  jump(): void {
    if (this.effectiveEnabled) this.jumpBuffer = this.tuning.pressBufferWindow;
  }
  dash(): void {
    if (this.effectiveEnabled) this.dashBuffer = this.tuning.pressBufferWindow;
  }
  setJumpHeld(held: boolean): void {
    this.heldJump = held;
  }

  /** Withdraw this producer's moves; other producers retain their claims. */
  cancel(): void {
    for (const handle of this.holds) handle.cancel();
    for (const handle of this.commands) handle.cancel();
    this.holds = [];
    this.commands = [];
    this.jumpBuffer = this.dashBuffer = -1;
    this.holdLeft = this.dashLeft = this.wallLeft = 0;
    this.heldJump = false;
  }

  onDisable(): void {
    this.cancel();
  }

  fixedUpdate(dt: number): void {
    finite("PlatformerMoves.fixedUpdate", "dt", dt, 0);
    if (!this.effectiveEnabled || dt === 0) return;
    const { motion, admission, controller } = this.options;
    if (motion.solverOwned) {
      this.cancel();
      return;
    }
    this.commands = this.commands.filter((handle) => handle.active);
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.dashLeft = Math.max(0, this.dashLeft - dt);
    this.wallLeft = Math.max(0, this.wallLeft - dt);
    if (this.dashLeft === 0 && this.wallLeft === 0) this.endHolds();
    let jumped = false;
    if (this.jumpBuffer >= 0) {
      const kind = admission.canGroundJump
        ? "ground"
        : this.options.wallJump !== false && admission.canWallJump
          ? "wall"
          : admission.canAirJump
            ? "air"
            : undefined;
      if (kind) {
        this.endHolds();
        this.dashLeft = this.wallLeft = this.holdLeft = 0;
        this.jumpBuffer = -1;
        if (kind === "wall") {
          const side = -admission.wallJumpSide;
          admission.spendWallJump();
          this.holds.push(
            motion.submitDurable({
              source: "platformer:wall-jump",
              axis: "x",
              target: side * this.tuning.wallJumpSpeedX,
              acceleration: Infinity,
              priority: this.priority,
            }),
          );
          this.wallLeft = this.tuning.wallJumpLockout;
          this.command("wall-jump", "y", -this.tuning.wallJumpSpeedY);
        } else if (kind === "ground") {
          admission.spendGroundJump();
          this.command("jump", "y", -this.tuning.jumpSpeed, "launch");
          this.holdLeft = this.tuning.jumpHoldWindow;
        } else {
          admission.spendAirJump();
          this.command(
            "air-jump",
            "y",
            Math.min(motion.velocityY, -this.tuning.doubleJumpSpeed),
          );
        }
        jumped = true;
        this.entity.emit(PlatformerJumpedEvent, { kind });
        if (!this.effectiveEnabled || this.entity.isDestroyed) return;
      }
    }
    if (
      !jumped &&
      this.dashBuffer >= 0 &&
      this.options.dash !== false &&
      this.dashReady
    ) {
      this.endHolds();
      this.holdLeft = this.wallLeft = 0;
      this.dashBuffer = -1;
      this.dashLeft = this.tuning.dashDuration;
      this.cooldown = this.tuning.dashCooldown;
      admission.spendDash();
      const direction = controller.facing;
      for (const axis of ["x", "y"] as const) {
        this.holds.push(
          motion.submitDurable({
            source: "platformer:dash",
            axis,
            target: axis === "x" ? direction * this.tuning.dashSpeed : 0,
            acceleration: Infinity,
            priority: this.priority,
            terrain: "grounded",
          }),
        );
      }
      this.entity.emit(PlatformerDashedEvent, { direction });
      if (!this.effectiveEnabled || this.entity.isDestroyed) return;
    } else if (!jumped && this.options.slide !== false && admission.canSlide) {
      admission.spendSlide();
      this.endHolds();
      this.dashLeft = this.wallLeft = 0;
      this.command(
        "slide",
        "x",
        controller.direction * this.tuning.slideSpeed,
        "surface",
      );
      this.entity.emit(PlatformerSlidEvent);
      if (!this.effectiveEnabled || this.entity.isDestroyed) return;
    }
    if (!jumped && this.holdLeft > 0) {
      if (!this.heldJump) {
        this.command(
          "jump-cut",
          "y",
          Math.max(
            motion.velocityY,
            -this.tuning.jumpCutSpeed + motion.launchSurfaceY,
          ),
        );
        this.holdLeft = 0;
      } else this.holdLeft = Math.max(0, this.holdLeft - dt);
    }
    this.jumpBuffer = Math.max(-1, this.jumpBuffer - dt);
    this.dashBuffer = Math.max(-1, this.dashBuffer - dt);
  }

  private command(
    source: string,
    axis: "x" | "y",
    target: number,
    frame: "world" | "surface" | "launch" = "world",
  ): void {
    this.commands.push(
      this.options.motion.submitOnce({
        source: `platformer:${source}`,
        axis,
        target,
        frame,
        acceleration: Infinity,
        priority: this.priority,
      }),
    );
  }

  private endHolds(): void {
    for (const handle of this.holds) handle.end();
    this.holds = [];
  }
}
