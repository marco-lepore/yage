/**
 * Shared helpers for the offline renderers: buffer measurements, gain
 * staging, fades, loop preparation and a fast sine table. Everything works
 * on plain Float32Arrays and never touches WebAudio, so it runs in Node.
 */

export const TWO_PI = Math.PI * 2;

const SINE_BITS = 12;
const SINE_SIZE = 1 << SINE_BITS;
const SINE_MASK = SINE_SIZE - 1;
/** One cycle of sine plus a guard sample for interpolation (read-only). */
const SINE_TABLE: Float64Array = (() => {
  const t = new Float64Array(SINE_SIZE + 1);
  for (let i = 0; i <= SINE_SIZE; i++)
    t[i] = Math.sin((TWO_PI * i) / SINE_SIZE);
  return t;
})();

/** Fast sine of a phase in cycles (1.0 = one period), linear-interpolated table lookup. */
export function sinCycles(phase: number): number {
  const x = (phase - Math.floor(phase)) * SINE_SIZE;
  const i = x | 0;
  const f = x - i;
  const a = SINE_TABLE[i & SINE_MASK]!;
  const b = SINE_TABLE[(i & SINE_MASK) + 1]!;
  return a + (b - a) * f;
}

/** Throws unless every named value is a positive finite number. */
export function requirePositive(
  method: string,
  values: Readonly<Record<string, number>>,
): void {
  for (const [name, value] of Object.entries(values))
    if (!(Number.isFinite(value) && value > 0))
      throw new Error(
        `${method}: ${name} must be a positive finite number, got ${value}`,
      );
}

/** Throws unless every named value is a finite number of zero or more. */
export function requireNonNegative(
  method: string,
  values: Readonly<Record<string, number>>,
): void {
  for (const [name, value] of Object.entries(values))
    if (!(Number.isFinite(value) && value >= 0))
      throw new Error(
        `${method}: ${name} must be a finite number of zero or more, got ${value}`,
      );
}

export function samples(seconds: number, sr: number): number {
  return Math.max(1, Math.round(seconds * sr));
}

/** Largest absolute sample value. */
export function peak(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i]!);
    if (v > p) p = v;
  }
  return p;
}

export function scale(buf: Float32Array, gain: number): Float32Array {
  for (let i = 0; i < buf.length; i++) buf[i] = buf[i]! * gain;
  return buf;
}

/** Scale so the peak equals `target` (silence stays silence). */
export function normalize(buf: Float32Array, target = 0.9): Float32Array {
  const p = peak(buf);
  if (p > 1e-9) scale(buf, target / p);
  return buf;
}

/**
 * Transparent below `ceiling * 0.7`, then a smooth knee that never exceeds
 * `ceiling`. A peak of 0.9 comes out at about 0.87.
 */
export function limit(buf: Float32Array, ceiling = 0.97): Float32Array {
  const knee = ceiling * 0.7;
  const room = ceiling - knee;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i]!;
    const a = Math.abs(v);
    if (a > knee) {
      const over = (a - knee) / room;
      buf[i] = Math.sign(v) * (knee + room * Math.tanh(over));
    }
  }
  return buf;
}

/** tanh-style saturation with a drive amount; unity gain for small signals. */
export function saturate(buf: Float32Array, drive: number): Float32Array {
  if (drive <= 0) return buf;
  const norm = 1 / Math.tanh(drive);
  for (let i = 0; i < buf.length; i++)
    buf[i] = Math.tanh(buf[i]! * drive) * norm;
  return buf;
}

/** Linear fade from silence over the first `n` samples. */
export function fadeIn(buf: Float32Array, n: number): Float32Array {
  const len = Math.min(n, buf.length);
  for (let i = 0; i < len; i++) buf[i] = buf[i]! * (i / len);
  return buf;
}

/** Raised-cosine fade to silence over the last `n` samples. */
export function fadeOut(buf: Float32Array, n: number): Float32Array {
  const len = Math.min(n, buf.length);
  const start = buf.length - len;
  for (let i = 0; i < len; i++)
    buf[start + i] =
      buf[start + i]! * 0.5 * (1 + Math.cos((Math.PI * (i + 1)) / len));
  return buf;
}

/** Remove DC with a one-pole high-pass at ~10 Hz. */
export function dcBlock(buf: Float32Array, sr: number): Float32Array {
  const r = Math.exp((-TWO_PI * 10) / sr);
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    const y = x - x1 + r * y1;
    x1 = x;
    y1 = y;
    buf[i] = y;
  }
  return buf;
}

/** Per-sample multiplier that decays by 60 dB in `t60` seconds. */
export function t60Coef(t60: number, sr: number): number {
  return Math.pow(0.001, 1 / Math.max(1e-4, t60 * sr));
}

/**
 * Make [loopStart, loopEnd) loop seamlessly: the `xfade` samples before
 * `loopEnd` are cross-faded into the samples before `loopStart`, so jumping
 * from loopEnd back to loopStart is continuous. Use "linear" when the two
 * regions are phase-aligned (see `bestLoopEnd`), "power" for noise.
 */
export function makeLoopable(
  buf: Float32Array,
  loopStart: number,
  loopEnd: number,
  xfade: number,
  curve: "linear" | "power" = "power",
): void {
  const x = Math.min(xfade, loopStart, loopEnd - loopStart);
  for (let i = 0; i < x; i++) {
    const w = (i + 0.5) / x;
    const a = curve === "power" ? Math.cos((w * Math.PI) / 2) : 1 - w;
    const b = curve === "power" ? Math.sin((w * Math.PI) / 2) : w;
    const endIdx = loopEnd - x + i;
    const preIdx = loopStart - x + i;
    buf[endIdx] = buf[endIdx]! * a + buf[preIdx]! * b;
  }
}

/**
 * The loop end within ±`radius` samples of `approxEnd` whose preceding
 * `window` samples best match the `window` samples before `loopStart`
 * (normalised cross-correlation), so a tonal loop joins in phase.
 */
export function bestLoopEnd(
  buf: Float32Array,
  loopStart: number,
  approxEnd: number,
  radius: number,
  window: number,
): number {
  const w = Math.min(window, loopStart);
  let best = Math.min(approxEnd, buf.length);
  let bestScore = -Infinity;
  let e0 = 0;
  for (let k = 0; k < w; k++) e0 += buf[loopStart - w + k]! ** 2;
  const lo = Math.max(loopStart + w + 1, approxEnd - radius);
  const hi = Math.min(buf.length, approxEnd + radius);
  for (let end = lo; end <= hi; end++) {
    let num = 0;
    let e1 = 0;
    for (let k = 0; k < w; k++) {
      const a = buf[loopStart - w + k]!;
      const b = buf[end - w + k]!;
      num += a * b;
      e1 += b * b;
    }
    const score = num / Math.sqrt(e0 * e1 + 1e-12);
    if (score > bestScore) {
      bestScore = score;
      best = end;
    }
  }
  return best;
}

/**
 * Prepare a tonal sustain loop: find a phase-matched end near `approxEnd`
 * (searching ±1 period) and cross-fade linearly. Returns the chosen end.
 */
export function prepareTonalLoop(
  buf: Float32Array,
  sr: number,
  loopStart: number,
  approxEnd: number,
  freq: number,
  xfade: number,
): number {
  const period = Math.max(2, Math.round(sr / freq));
  const end = bestLoopEnd(
    buf,
    loopStart,
    Math.min(approxEnd, buf.length - 1),
    period,
    Math.min(loopStart, Math.max(256, period * 3)),
  );
  makeLoopable(buf, loopStart, end, xfade, "linear");
  return end;
}

/** Hermite (4-point, 3rd order) interpolation of `buf` at fractional index `x`. */
export function hermite(buf: Float32Array, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const xm1 = i >= 1 ? buf[i - 1]! : 0;
  const x0 = i >= 0 && i < buf.length ? buf[i]! : 0;
  const x1 = i + 1 < buf.length && i + 1 >= 0 ? buf[i + 1]! : 0;
  const x2 = i + 2 < buf.length && i + 2 >= 0 ? buf[i + 2]! : 0;
  const c1 = 0.5 * (x1 - xm1);
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
}

/** PolyBLEP residual for band-limited sawtooth/square edges. */
export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}
