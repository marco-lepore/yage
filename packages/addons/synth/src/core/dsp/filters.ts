/**
 * Offline filters over Float32Arrays: RBJ-cookbook biquads, one-pole
 * filters and a time-varying state-variable filter (for sweeps).
 */
import { TWO_PI, requireFinite, requirePositive } from "./util.js";

export type SynthBiquadType =
  | "lowpass"
  | "highpass"
  | "bandpass"
  | "peaking"
  | "lowshelf"
  | "highshelf"
  | "notch";

export interface BiquadCoefs {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

/** RBJ cookbook coefficients, normalised by a0. `gainDb` is for peaking/shelves. */
export function biquadCoefs(
  type: SynthBiquadType,
  freq: number,
  q: number,
  sr: number,
  gainDb = 0,
): BiquadCoefs {
  const f = Math.min(Math.max(freq, 1), sr * 0.49);
  const w0 = (TWO_PI * f) / sr;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * Math.max(q, 1e-3));
  const A = Math.pow(10, gainDb / 40);
  let b0 = 1;
  let b1 = 0;
  let b2 = 0;
  let a0 = 1;
  let a1 = 0;
  let a2 = 0;
  switch (type) {
    case "lowpass":
      b0 = (1 - cw) / 2;
      b1 = 1 - cw;
      b2 = (1 - cw) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
      break;
    case "highpass":
      b0 = (1 + cw) / 2;
      b1 = -(1 + cw);
      b2 = (1 + cw) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
      break;
    case "bandpass": // constant 0 dB peak gain
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
      break;
    case "notch":
      b0 = 1;
      b1 = -2 * cw;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
      break;
    case "peaking":
      b0 = 1 + alpha * A;
      b1 = -2 * cw;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cw;
      a2 = 1 - alpha / A;
      break;
    case "lowshelf": {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cw + s);
      b1 = 2 * A * (A - 1 - (A + 1) * cw);
      b2 = A * (A + 1 - (A - 1) * cw - s);
      a0 = A + 1 + (A - 1) * cw + s;
      a1 = -2 * (A - 1 + (A + 1) * cw);
      a2 = A + 1 + (A - 1) * cw - s;
      break;
    }
    case "highshelf": {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cw + s);
      b1 = -2 * A * (A - 1 + (A + 1) * cw);
      b2 = A * (A + 1 + (A - 1) * cw - s);
      a0 = A + 1 - (A - 1) * cw + s;
      a1 = 2 * (A - 1 - (A + 1) * cw);
      a2 = A + 1 - (A - 1) * cw - s;
      break;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Run a biquad over `buf` in place (transposed direct form II). */
export function biquad(
  buf: Float32Array,
  type: SynthBiquadType,
  freq: number,
  q: number,
  sr: number,
  gainDb = 0,
): Float32Array {
  requirePositive("biquad", { sampleRate: sr });
  requireFinite("biquad", { freq, q, gainDb });
  const c = biquadCoefs(type, freq, q, sr, gainDb);
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    const y = c.b0 * x + z1;
    z1 = c.b1 * x - c.a1 * y + z2;
    z2 = c.b2 * x - c.a2 * y;
    buf[i] = y;
  }
  return buf;
}

/** One-pole low-pass in place. */
export function onePoleLP(
  buf: Float32Array,
  freq: number,
  sr: number,
): Float32Array {
  const a = 1 - Math.exp((-TWO_PI * Math.min(freq, sr * 0.49)) / sr);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y += a * (buf[i]! - y);
    buf[i] = y;
  }
  return buf;
}

export type SynthSvfMode = "low" | "band" | "high" | "notch";

/**
 * Zero-delay-feedback state-variable filter with a cutoff that can change
 * every sample: `freq(t)` receives seconds from the start. Coefficients are
 * refreshed every 8 samples. The band output is normalised to 0 dB peak.
 */
export function svf(
  buf: Float32Array,
  mode: SynthSvfMode,
  freq: number | ((t: number) => number),
  q: number,
  sr: number,
): Float32Array {
  requirePositive("svf", { sampleRate: sr });
  requireFinite("svf", { q });
  const k = 1 / Math.max(q, 0.05);
  let ic1 = 0;
  let ic2 = 0;
  let a1 = 0;
  let a2 = 0;
  let a3 = 0;
  const update = (f: number): void => {
    const g = Math.tan((Math.PI * Math.min(Math.max(f, 10), sr * 0.45)) / sr);
    a1 = 1 / (1 + g * (g + k));
    a2 = g * a1;
    a3 = g * a2;
  };
  const fixed = typeof freq === "number";
  if (fixed) {
    requireFinite("svf", { freq });
    update(freq);
  }
  for (let i = 0; i < buf.length; i++) {
    if (!fixed && (i & 7) === 0) {
      const t = i / sr;
      const f = freq(t);
      if (!Number.isFinite(f))
        throw new Error(
          `svf: freq(${t}) must return a finite number, got ${f}`,
        );
      update(f);
    }
    const v0 = buf[i]!;
    const v3 = v0 - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    switch (mode) {
      case "low":
        buf[i] = v2;
        break;
      case "band":
        buf[i] = k * v1;
        break;
      case "high":
        buf[i] = v0 - k * v1 - v2;
        break;
      case "notch":
        buf[i] = v0 - k * v1;
        break;
    }
  }
  return buf;
}
