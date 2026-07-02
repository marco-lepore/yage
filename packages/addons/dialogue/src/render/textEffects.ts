/**
 * Per-glyph animated text effects. The line is one `SplitTextComponent`; we
 * animate each glyph node (`chars[i]`) individually, phased by its position
 * along the line — so `[wave]` ripples letter-by-letter, `[shake]` jitters each
 * glyph, `[rainbow]` cycles per glyph. Effects are pure functions of time + the
 * glyph's resting x (the phase), so they're deterministic and snapshot-safe.
 *
 * The effect name is an OPEN vocabulary (any `[name]` markup tag). This bundled
 * evaluator animates the four built-ins (wave / shake / pulse / rainbow — the
 * `BuiltinEffectId`s) and treats any other name — one a custom text channel owns,
 * or a typo — as a no-op (identity transform), so the run renders as plain styled
 * text.
 */

/** Mutable so a per-frame caller can reuse one scratch instance (see `out`). */
export interface EffectOutput {
  /** Offset from the run's resting position, in px. */
  dx: number;
  dy: number;
  /** Uniform scale multiplier (1 = none). */
  scale: number;
  /** Tint override (0xRRGGBB), or undefined to keep the run's base colour. */
  tint: number | undefined;
}

/**
 * @param effect    which effect by name (undefined or an unrecognized name → no motion)
 * @param time      elapsed time the run has been on screen, in seconds
 * @param phase     a per-run phase seed (use the run's resting x) so adjacent
 *                  runs animate out of sync instead of in lockstep
 * @param out       optional scratch object, reset and returned — pass one per
 *                  caller to avoid an allocation per animated glyph per frame
 */
export function evaluateEffect(
  effect: string | undefined,
  time: number,
  phase: number,
  out: EffectOutput = { dx: 0, dy: 0, scale: 1, tint: undefined },
): EffectOutput {
  out.dx = 0;
  out.dy = 0;
  out.scale = 1;
  out.tint = undefined;
  switch (effect) {
    case "wave":
      out.dy = Math.sin(time / 0.26 + phase / 14) * 1.6;
      break;
    case "shake":
      // Time-quantised jitter so it reads as a buzz, not per-frame noise.
      out.dx = pseudoNoise(time, phase) * 1.3;
      out.dy = pseudoNoise(time, phase + 99) * 1.3;
      break;
    case "pulse":
      out.scale = 1 + 0.09 * Math.sin(time / 0.22 + phase / 18);
      break;
    case "rainbow":
      out.tint = hsv((time / 0.018 + phase * 4) % 360, 0.55, 1);
      break;
  }
  return out;
}

/** True if the effect needs a tint each frame (so the view skips static tint).
 *  False for an unrecognized name (it animates nothing). */
export function effectDrivesTint(effect: string | undefined): boolean {
  return effect === "rainbow";
}

/** Cheap deterministic [-0.5, 0.5] noise quantised to ~30 Hz. */
function pseudoNoise(time: number, seed: number): number {
  const t = Math.floor(time * 30);
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
