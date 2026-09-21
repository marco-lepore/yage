import { clampUnit } from "./validation.js";

/**
 * @internal A spotlight cone's edge, as the two cosines every renderer and the
 * query share.
 *
 * The outer cosine sits at the spread's own edge, where the light ends. The
 * inner one sits where the light is at full strength, which softness pulls in
 * from the edge. A cone with no softness has both in the same place and its
 * edge is a step.
 *
 * The pair travels as two numbers rather than as an object because `levelAt`
 * reads it once per coned light per queried point, where an allocation shows.
 */

/** Cosine at the edge of a cone of `angle` full spread. */
export function coneOuterCosine(angle: number): number {
  return Math.cos(angle / 2);
}

/** Cosine where a cone of `angle` spread faded over `softness` is full. */
export function coneInnerCosine(angle: number, softness: number): number {
  return Math.cos((angle / 2) * (1 - softness));
}

/**
 * How much of a light reaches a direction whose cosine against the cone's aim
 * is `cosine`, from 0 outside the cone to 1 inside it. The fade is the same
 * smooth step the shader renderer runs per pixel, so the drawn picture and the
 * query answer with one number.
 */
export function coneFactor(
  cosine: number,
  outer: number,
  inner: number,
): number {
  if (inner <= outer) return cosine >= outer ? 1 : 0;
  const t = clampUnit((cosine - outer) / (inner - outer));
  return t * t * (3 - 2 * t);
}

/**
 * Half-spread at which the fade passes one half, in radians. A renderer that
 * draws one hard cone edge draws it there, so it sits in the middle of the
 * band the query fades across.
 */
export function coneMidHalfAngle(angle: number, softness: number): number {
  if (softness === 0) return angle / 2;
  const middle =
    (coneOuterCosine(angle) + coneInnerCosine(angle, softness)) / 2;
  return Math.acos(Math.max(-1, Math.min(1, middle)));
}
