import type { MoveAdmissionTuning } from "./MoveAdmission.js";
import type { PlatformerSetup } from "./installPlatformer.js";
import { count, tuningNumbers } from "../core/validate.js";

export interface PlatformerMoveTuning {
  readonly jumpSpeed: number;
  readonly jumpHoldWindow: number;
  readonly jumpCutSpeed: number;
  readonly doubleJumpSpeed: number;
  readonly pressBufferWindow: number;
  readonly dashSpeed: number;
  readonly dashDuration: number;
  readonly dashCooldown: number;
  readonly wallJumpSpeedX: number;
  readonly wallJumpSpeedY: number;
  readonly wallJumpLockout: number;
}

export type PlatformerConfig = PlatformerSetup["tuning"] &
  MoveAdmissionTuning &
  PlatformerMoveTuning & {
    readonly bodyHeight: number;
  };

/** Pixels, seconds and pixels/second. Suitable for a 16px tile world. */
export const DEFAULT_PLATFORMER_TUNING: Readonly<PlatformerConfig> =
  Object.freeze({
    runSpeed: 190,
    groundAcceleration: 1700,
    airAcceleration: 1500,
    groundShed: 1800,
    airShed: 340,
    gravity: 980,
    riseMultiplier: 1,
    fallMultiplier: 1.7,
    apexMultiplier: 0.5,
    apexSpeed: 60,
    terminalFallSpeed: 900,
    groundPressSpeed: 40,
    groundedRiseTolerance: 40,
    jumpSpeed: 434,
    jumpHoldWindow: 0.2,
    jumpCutSpeed: 240,
    doubleJumpSpeed: 360,
    airJumps: 1,
    coyoteTime: 0.1,
    pressBufferWindow: 0.12,
    dashSpeed: 520,
    dashDuration: 0.27,
    dashCooldown: 0.6,
    airDashes: 1,
    crouchHeight: 30,
    crouchAcceleration: 575,
    slideExitSpeed: 190,
    slideSpeed: 450,
    slideMinSpeed: 140,
    slideRestTime: 0.5,
    wallSlideSpeed: 120,
    wallJumpSpeedX: 370,
    wallJumpSpeedY: 434,
    wallJumpLockout: 0.16,
    wallCoyoteTime: 0.1,
    wallProbeDistance: 4,
    wallProbeHeight: 20,
    wallProbeCentreY: 15,
    groundProbeDistance: 3,
    maxSlopeAngle: 45,
    groundSnapDistance: 6,
    ledgeStepHeight: 6,
    ledgeMinWidth: 4,
    groundProbeInset: 1,
    bodyWidth: 16,
    bodyHeight: 44,
  });

/** A fresh validated config; change only the numbers your game needs. */
export function defaultPlatformerTuning(
  overrides: Partial<PlatformerConfig> = {},
): Readonly<PlatformerConfig> {
  const t = { ...DEFAULT_PLATFORMER_TUNING, ...overrides };
  tuningNumbers("defaultPlatformerTuning", t);
  if (
    t.bodyWidth <= 4 ||
    t.bodyHeight <= t.crouchHeight ||
    t.crouchHeight <= 0 ||
    t.bodyWidth <= 2 * t.groundProbeInset
  ) {
    throw new Error(
      "defaultPlatformerTuning: require bodyWidth > 4, 0 < crouchHeight < bodyHeight, and 2 * groundProbeInset < bodyWidth",
    );
  }
  if (t.maxSlopeAngle >= 90)
    throw new Error(
      `defaultPlatformerTuning: maxSlopeAngle must be < 90, got ${t.maxSlopeAngle}`,
    );
  count("defaultPlatformerTuning", "airJumps", t.airJumps);
  count("defaultPlatformerTuning", "airDashes", t.airDashes);
  return Object.freeze(t);
}
