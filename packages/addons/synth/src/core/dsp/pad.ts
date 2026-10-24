/**
 * The night pad that holds every bed: soft organ sines (1, 2, 3) under a
 * detuned pair of band-limited saws (a small string section) darkened by a
 * low-pass, with a slow swell and a drifting chorus. The render holds the
 * swell and a seamless sustain loop.
 */
import type { SynthRenderLoop } from "../defineInstrument.js";
import { biquad } from "./filters.js";
import { seededRandom } from "../random.js";
import {
  dcBlock,
  limit,
  normalize,
  polyBlep,
  prepareTonalLoop,
  samples,
  sinCycles,
} from "./util.js";

/** ln(2)/1200: small cent offsets as a linear frequency factor. */
const CENT = Math.LN2 / 1200;

export function renderPad(
  freq: number,
  sr: number,
  seed: number,
): SynthRenderLoop {
  const loopStart = 1.0;
  const loopEnd = 3.4;
  const n = samples(loopEnd + 0.08, sr);
  const out = new Float32Array(n);
  const rng = seededRandom(seed);
  const sines = [
    { h: 1, a: 1 },
    { h: 2, a: 0.3 },
    { h: 3, a: 0.1 },
  ].filter((s) => freq * s.h < sr * 0.45);
  const sinePhase = sines.map(() => rng());
  const sawDetune = [-7, 6];
  const sawPhase = sawDetune.map(() => rng());
  const attack = 0.5 * sr;
  const driftRate = 0.23 / sr;
  const driftDepth = 2.5 * CENT;
  for (let i = 0; i < n; i++) {
    const drift = 1 + driftDepth * sinCycles(driftRate * i);
    let v = 0;
    for (let k = 0; k < sines.length; k++) {
      v += sines[k]!.a * sinCycles(sinePhase[k]!);
      let p = sinePhase[k]! + (freq * sines[k]!.h) / sr;
      if (p >= 1) p -= 1;
      sinePhase[k] = p;
    }
    let strings = 0;
    for (let k = 0; k < sawDetune.length; k++) {
      const f =
        freq * (1 + sawDetune[k]! * CENT) * (k === 0 ? drift : 2 - drift);
      const dt = f / sr;
      const p = sawPhase[k]!;
      strings += 2 * p - 1 - polyBlep(p, dt);
      let np = p + dt;
      if (np >= 1) np -= 1;
      sawPhase[k] = np;
    }
    const env = i < attack ? 0.5 - 0.5 * Math.cos((Math.PI * i) / attack) : 1;
    out[i] = (0.7 * v + 0.32 * strings) * env;
  }
  // Keep the strings soft: a gentle low-pass around the 5th harmonic, a dip in the upper mids.
  biquad(out, "lowpass", Math.min(2400, freq * 5), 0.6, sr);
  biquad(out, "highshelf", 3000, 0.7, sr, -3);
  biquad(out, "highpass", 40, 0.7, sr);
  dcBlock(out, sr);
  normalize(out, 0.85);
  const ls = samples(loopStart, sr);
  const le = prepareTonalLoop(
    out,
    sr,
    ls,
    samples(loopEnd, sr),
    freq,
    samples(0.3, sr),
  );
  limit(out, 0.97);
  return { samples: out, loopStart: ls, loopEnd: le };
}
