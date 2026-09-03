/**
 * Numeric gates for an emitter's configuration. Each throws a plain `Error`
 * naming the option and the constraint it violates, before the container and
 * the pool are built. Unchecked, these values reach particle state and stay
 * there: `damping` above 1 raises a negative base to a fractional exponent and
 * turns every velocity and position into `NaN`, and a non-integer or infinite
 * `maxParticles` runs the pool's pre-allocation loop forever.
 */

import { isLerped } from "./types.js";
import type { EmitterConfig, Lerped, NumberRange } from "./types.js";

const CONTEXT = "ParticleEmitterComponent";

interface Constraint {
  /** True when the value is usable. */
  accepts(value: number): boolean;
  /** Reads after the option name: "<name> <text>, got …". */
  readonly text: string;
}

const finite: Constraint = {
  accepts: (v) => Number.isFinite(v),
  text: "must be finite",
};

const atLeastZero: Constraint = {
  accepts: (v) => Number.isFinite(v) && v >= 0,
  text: "must be finite and >= 0",
};

const aboveZero: Constraint = {
  accepts: (v) => Number.isFinite(v) && v > 0,
  text: "must be finite and > 0",
};

const wholeCount: Constraint = {
  accepts: (v) => Number.isInteger(v) && v >= 0,
  text: "must be a whole number >= 0",
};

const zeroToOne: Constraint = {
  accepts: (v) => Number.isFinite(v) && v >= 0 && v <= 1,
  text: "must be between 0 and 1",
};

/** Check every numeric entry of `config`. Throws on the first bad one. */
export function assertEmitterConfig(config: EmitterConfig): void {
  assertNumber("maxParticles", config.maxParticles, wholeCount);
  assertNumber("rate", config.rate, atLeastZero);
  assertNumber("tint", config.tint, finite);
  assertNumber("damping", config.damping, zeroToOne);
  assertRange("lifetime", config.lifetime, aboveZero);
  assertRange("speed", config.speed, finite);
  assertRange("angle", config.angle, finite);
  assertRange("rotation", config.rotation, finite);
  assertRange("rotationSpeed", config.rotationSpeed, finite);
  assertRange("radialSpeed", config.radialSpeed, finite);
  assertLerpable("scale", config.scale, finite);
  assertLerpable("alpha", config.alpha, finite);

  if (config.gravity !== undefined) {
    assertNumber("gravity.x", config.gravity.x, finite);
    assertNumber("gravity.y", config.gravity.y, finite);
  }

  const offset = config.spawnOffset;
  if (offset !== undefined) {
    if (offset.radius !== undefined) {
      assertRange("spawnOffset.radius", offset.radius, finite);
      assertRange("spawnOffset.angle", offset.angle, finite);
    } else {
      assertRange("spawnOffset.x", offset.x, finite);
      assertRange("spawnOffset.y", offset.y, finite);
    }
  } else if (config.radialSpeed !== undefined) {
    throw new Error(
      `${CONTEXT}: radialSpeed needs a spawnOffset — a particle spawning at the emitter's origin has no outward direction.`,
    );
  }
}

function assertNumber(
  name: string,
  value: number | undefined,
  constraint: Constraint,
): void {
  if (value === undefined || constraint.accepts(value)) return;
  throw new Error(`${CONTEXT}: ${name} ${constraint.text}, got ${value}.`);
}

/** Each end of a `[min, max]` tuple is checked; the message names which one. */
function assertRange(
  name: string,
  value: NumberRange | undefined,
  constraint: Constraint,
): void {
  if (value === undefined) return;
  if (typeof value === "number") {
    assertNumber(name, value, constraint);
    return;
  }
  for (let i = 0; i < value.length; i++) {
    const end = value[i]!;
    if (constraint.accepts(end)) continue;
    throw new Error(
      `${CONTEXT}: ${name}[${i}] ${constraint.text}, got [${value[0]}, ${value[1]}].`,
    );
  }
}

function assertLerpable(
  name: string,
  value: NumberRange | Lerped | undefined,
  constraint: Constraint,
): void {
  if (value === undefined) return;
  if (isLerped(value)) {
    assertRange(`${name}.start`, value.start, constraint);
    assertRange(`${name}.end`, value.end, constraint);
    return;
  }
  assertRange(name, value, constraint);
}
