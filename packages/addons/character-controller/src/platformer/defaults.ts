import type { MoveAdmissionTuning } from "./MoveAdmission.js";
import type { PlatformerTuning } from "./PlatformerTuning.js";
import type { TerrainTuning } from "./TerrainAssist.js";
import { count, tuningNumbers } from "../core/validate.js";

export interface PlatformerMoveTuning {
  /** Upward speed a ground jump starts at, px/s. */
  readonly jumpSpeed: number;
  /** How long after a ground jump releasing jump still cuts the rise, seconds. */
  readonly jumpHoldWindow: number;
  /** Upward speed a released jump is cut to, px/s. */
  readonly jumpCutSpeed: number;
  /** Upward speed an air jump starts at, px/s. */
  readonly doubleJumpSpeed: number;
  /** How long a jump, dash, or drop press waits for the move to become available, seconds. */
  readonly pressBufferWindow: number;
  /** Horizontal dash speed, px/s. */
  readonly dashSpeed: number;
  /** How long a dash holds its speed, seconds. */
  readonly dashDuration: number;
  /** How long after a dash starts the next one may start, seconds. */
  readonly dashCooldown: number;
  /** Horizontal speed away from the wall at a wall jump, px/s. */
  readonly wallJumpSpeedX: number;
  /** Upward speed of a wall jump, px/s. */
  readonly wallJumpSpeedY: number;
  /** How long a wall jump holds its horizontal speed against steering, seconds. */
  readonly wallJumpLockout: number;
  /** How long a drop lets the body pass through one-way platforms, seconds. */
  readonly dropThroughTime: number;
}

/** Body size and the probes measured from it. */
export interface PlatformerBodyTuning {
  /** Width of a created collider, px. An existing collider sets it instead. */
  readonly bodyWidth: number;
  /** Height of a created collider, px. An existing collider sets it instead. */
  readonly bodyHeight: number;
  /** Collider height while crouched, px. */
  readonly crouchHeight: number;
  /** How far in from each side the ground probe starts, px. */
  readonly groundProbeInset: number;
  /** How far below the feet ground still counts as contact, px. */
  readonly groundProbeDistance: number;
  /** Height of the band that detects walls, px. */
  readonly wallProbeHeight: number;
  /** Height of that band's centre above the feet, px. */
  readonly wallProbeCentreY: number;
  /** How far beside the body a wall still counts as contact, px. */
  readonly wallProbeDistance: number;
  /** Steepest walkable slope, degrees. Must be below 90. */
  readonly maxSlopeAngle: number;
}

/** Every number `createPlatformer` uses. Pixels, seconds, px/s, and px/s². */
export type PlatformerConfig = PlatformerTuning &
  TerrainTuning &
  MoveAdmissionTuning &
  PlatformerMoveTuning &
  PlatformerBodyTuning;

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
    dropThroughTime: 0.25,
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
