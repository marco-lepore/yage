/**
 * Per-glyph animated text effects. The line is one `SplitTextComponent`; we
 * animate each glyph node (`chars[i]`) individually, phased by its position
 * along the line — so `[wave]` ripples letter-by-letter, `[shake]` jitters each
 * glyph, `[rainbow]` cycles per glyph. Effects are pure functions of time + the
 * glyph's resting x (the phase), so they're deterministic and snapshot-safe.
 */

import type { EffectId } from "../core/types.js";

export interface EffectOutput {
  /** Offset from the run's resting position, in px. */
  readonly dx: number;
  readonly dy: number;
  /** Uniform scale multiplier (1 = none). */
  readonly scale: number;
  /** Tint override (0xRRGGBB), or undefined to keep the run's base colour. */
  readonly tint?: number;
}

const STILL: EffectOutput = { dx: 0, dy: 0, scale: 1 };

/**
 * @param effect    which effect (undefined → no motion)
 * @param timeMs    elapsed time the run has been on screen
 * @param phase     a per-run phase seed (use the run's resting x) so adjacent
 *                  runs animate out of sync instead of in lockstep
 */
export function evaluateEffect(
  effect: EffectId | undefined,
  timeMs: number,
  phase: number,
): EffectOutput {
  switch (effect) {
    case "wave":
      return { dx: 0, dy: Math.sin(timeMs / 260 + phase / 14) * 1.6, scale: 1 };
    case "shake":
      // Time-quantised jitter so it reads as a buzz, not per-frame noise.
      return {
        dx: pseudoNoise(timeMs, phase) * 1.3,
        dy: pseudoNoise(timeMs, phase + 99) * 1.3,
        scale: 1,
      };
    case "pulse":
      return { dx: 0, dy: 0, scale: 1 + 0.09 * Math.sin(timeMs / 220 + phase / 18) };
    case "rainbow":
      return {
        dx: 0,
        dy: 0,
        scale: 1,
        tint: hsv((timeMs / 18 + phase * 4) % 360, 0.55, 1),
      };
    default:
      return STILL;
  }
}

/** True if the effect needs a tint each frame (so the view skips static tint). */
export function effectDrivesTint(effect: EffectId | undefined): boolean {
  return effect === "rainbow";
}

/** Cheap deterministic [-0.5, 0.5] noise quantised to ~30 Hz. */
function pseudoNoise(timeMs: number, seed: number): number {
  const t = Math.floor(timeMs / 33);
  const x = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453;
  return (x - Math.floor(x)) - 0.5;
}

function hsv(h: number, s: number, v: number): number {
  const c = v * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const [r, g, b] = rgb;
  const m = v - c;
  return (
    (Math.round((r + m) * 255) << 16) |
    (Math.round((g + m) * 255) << 8) |
    Math.round((b + m) * 255)
  );
}
