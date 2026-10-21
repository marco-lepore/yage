/**
 * Seeded noise generators. Same seed, same buffer, on every platform.
 */
import { Rng } from "./rng.js";
import { makeLoopable, normalize, samples } from "./util.js";

/** Uniform white noise in [-1, 1). */
export function whiteNoise(n: number, seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rng.next() * 2 - 1;
  return out;
}

/** Pink (−3 dB/octave) noise, Paul Kellet's refined filter, peak-normalised to 0.9. */
export function pinkNoise(n: number, seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Float32Array(n);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rng.next() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return normalize(out, 0.9);
}

/** Brown (−6 dB/octave) noise: leaky-integrated white, peak-normalised to 0.9. */
export function brownNoise(n: number, seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) {
    y = (y + 0.02 * (rng.next() * 2 - 1)) * 0.997;
    out[i] = y;
  }
  // Remove the slow wander so the buffer centres on zero.
  let mean = 0;
  for (let i = 0; i < n; i++) mean += out[i]!;
  mean /= Math.max(1, n);
  for (let i = 0; i < n; i++) out[i] = out[i]! - mean;
  return normalize(out, 0.9);
}

/** A loop-ready noise buffer of `seconds` (seam cross-faded) for continuous loops. */
export function loopNoise(
  generate: (length: number, seed: number) => Float32Array,
  seconds: number,
  sr: number,
  seed: number,
): Float32Array {
  const xfade = samples(0.05, sr);
  const n = samples(seconds, sr) + xfade;
  const src = generate(n, seed);
  makeLoopable(src, xfade, n, xfade);
  // Drop the pre-roll so the whole buffer is the loop.
  return src.slice(xfade);
}
