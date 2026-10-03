import { finite } from "./validate.js";
export type MotionAxis = "x" | "y";

/** Continuous steering is the baseline; consumer moves choose higher priorities. */
export const CHARACTER_CONTROLLER_PRIORITY = 0;

/**
 * One submitter's description of how it wants an axis to move. Data — never a
 * call that moves something.
 *
 * Continuous intents belong to the current step. One-time commands wait for
 * one advancing resolution. Durable intents stay until their handle ends them,
 * preserving a first advancing resolution unless explicitly cancelled.
 */
export interface MotionIntent {
  /** Who submitted it. Named when an intent is refused. */
  readonly source: string;
  /** Permit terrain correction while grounded. Other winning claims may still refuse it. */
  readonly terrain?: "grounded";
  /** Surface-relative locomotion; launch inherits upward support speed only. Default: world. */
  readonly frame?: "surface" | "launch" | "world";
  readonly axis: MotionAxis;
  /** The speed the submitter wants this axis to reach, px/s. */
  readonly target: number;
  /** How fast it may close on that speed, px/s². `Infinity` arrives this step. */
  readonly acceleration: number;

  /** Deceleration in px/s² when already travelling toward the target faster than its speed. */
  readonly shed?: number;
  /** Higher takes the axis. */
  readonly priority: number;
}

/** A queued claim. Cancellation is idempotent and never changes body velocity. */
export interface MotionIntentHandle {
  /** Still queued, either awaiting first resolution or held across steps. */
  readonly active: boolean;
  cancel(): void;
}

export interface DurableIntentHandle extends MotionIntentHandle {
  /** Stop holding, preserving a first advancing resolution if still pending. */
  end(): void;
}

export interface RefusedIntent {
  readonly source: string;
  readonly axis: MotionAxis;
  /** The source that took the axis instead. */
  readonly outrankedBy: string;
}

export interface MotionResolution {
  readonly x: number;
  readonly y: number;
  readonly refused: readonly RefusedIntent[];
}

/**
 * The resolution rule, in full:
 *
 * - Axes resolve independently, so an intent claiming one axis leaves the other
 *   to whoever claimed it.
 * - On each axis the highest priority takes it. Every other intent on that axis
 *   is refused, and named in the result rather than dropped.
 * - Two intents tied at the highest priority on an axis is a contract breach and
 *   throws, because which one takes the axis would then be ordering luck, and
 *   that is the failure this whole arrangement exists to prevent. A tie below
 *   the winner is not a breach: both are refused either way.
 * - An axis nothing claimed keeps the speed it already had.
 * - The winner moves the current speed toward its target by at most one rate
 *   times `dt`: its `shed` rate when the axis already moves the target's way
 *   and faster than it, its `acceleration` otherwise. Released, so that the
 *   target is zero, and held against the current speed are both the second
 *   case; only holding toward speed above the target is the first.
 *
 * Only override intents are supported.
 */
export function resolveMotion(
  intents: readonly MotionIntent[],
  current: { readonly x: number; readonly y: number },
  dt: number,
  surface = { x: 0, y: 0, previousX: 0, previousY: 0 },
): MotionResolution {
  finite("resolveMotion", "dt", dt, 0);
  finite("resolveMotion", "current.x", current.x);
  finite("resolveMotion", "current.y", current.y);
  for (const [key, value] of Object.entries(surface))
    finite("resolveMotion", `surface.${key}`, value);
  for (const intent of intents) validateMotionIntent(intent);
  const refused: RefusedIntent[] = [];
  return {
    x: resolveAxis(
      intents,
      "x",
      current.x,
      dt,
      refused,
      surface.x,
      surface.previousX,
    ),
    y: resolveAxis(
      intents,
      "y",
      current.y,
      dt,
      refused,
      surface.y,
      surface.previousY,
    ),
    refused,
  };
}

function resolveAxis(
  intents: readonly MotionIntent[],
  axis: MotionAxis,
  current: number,
  dt: number,
  refused: RefusedIntent[],
  support: number,
  previous: number,
): number {
  let winner: MotionIntent | undefined;
  let tiedWithWinner: string[] = [];
  for (const intent of intents) {
    if (intent.axis !== axis) continue;
    if (winner === undefined || intent.priority > winner.priority) {
      winner = intent;
      tiedWithWinner = [intent.source];
    } else if (intent.priority === winner.priority) {
      tiedWithWinner.push(intent.source);
    }
  }

  if (winner === undefined) return current;
  if (tiedWithWinner.length > 1) {
    throw new Error(
      `Motion intents ${tiedWithWinner.map((s) => `"${s}"`).join(" and ")} all claim ${axis} at ` +
        `priority ${winner.priority}. One of them has to outrank the others.`,
    );
  }

  for (const intent of intents) {
    if (intent.axis === axis && intent !== winner) {
      refused.push({ source: intent.source, axis, outrankedBy: winner.source });
    }
  }

  // A zero-time step must not adopt support motion or evaluate Infinity × 0.
  if (dt === 0) return current;
  const offset =
    winner.frame === "surface"
      ? support
      : winner.frame === "launch"
        ? Math.min(support, 0)
        : 0;
  if (winner.frame === "surface") current -= previous;
  const target = winner.target + (winner.frame === "launch" ? offset : 0);
  const shedding =
    Math.sign(current) === Math.sign(target) &&
    Math.abs(current) > Math.abs(target);
  const rate =
    shedding && winner.shed !== undefined ? winner.shed : winner.acceleration;
  const step = rate * dt;
  const delta = target - current;
  const result =
    Math.abs(delta) <= step ? target : current + Math.sign(delta) * step;
  const value = result + (winner.frame === "surface" ? offset : 0);
  finite("resolveMotion", `${axis} result`, value);
  return value;
}

/** Validate before a request enters the queue. Infinity is allowed only for rates. */
export function validateMotionIntent(intent: MotionIntent): void {
  finite("MotionIntent", "target", intent.target);
  finite("MotionIntent", "priority", intent.priority);
  if (intent.acceleration !== Infinity)
    finite("MotionIntent", "acceleration", intent.acceleration, 0);
  if (intent.shed !== undefined && intent.shed !== Infinity)
    finite("MotionIntent", "shed", intent.shed, 0);
}

/** Replace the headless arbitration model while retaining engine integration. */
export type MotionResolver = typeof resolveMotion;
