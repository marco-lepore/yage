/**
 * Plucked strings: extended Karplus–Strong. A noise burst shaped by pick
 * position and brightness excites a delay-line loop with a two-tap damping
 * filter; the loop length follows an optional pitch glide at the attack and
 * an optional delayed vibrato. A body filter gives each instrument its
 * resonance. Presets: banjo, upright bass, a steel cable twang, the guzheng
 * (a festival zither) and a warm plucked bass.
 */
import { biquad, onePoleLP } from "./filters.js";
import { Rng } from "./rng.js";
import {
  dcBlock,
  fadeIn,
  fadeOut,
  hermite,
  limit,
  normalize,
  samples,
  sinCycles,
} from "./util.js";

export interface PluckOptions {
  readonly freq: number;
  readonly duration: number;
  /** Seconds for the fundamental to decay by 60 dB. */
  readonly t60: number;
  /** 0 = dark (thumb on gut), 1 = bright (steel under a pick or plectrum). */
  readonly brightness: number;
  /** Pluck point as a fraction of the string (0.5 = middle, small = near the bridge). */
  readonly pickPosition: number;
  /**
   * Pitch offset at the attack in cents, gliding to pitch: positive starts
   * sharp (a hard pluck's tension), negative starts flat and bends up.
   */
  readonly twangCents?: number;
  /** Time constant of the glide in seconds. */
  readonly twangTime?: number;
  /** Delayed vibrato: rate (Hz), depth (cents), onset delay (s); it swells in over 0.4 s. */
  readonly vibrato?: {
    readonly hz: number;
    readonly cents: number;
    readonly delay: number;
  };
  /** Level of a sine "thump" at the fundamental in the first ~60 ms (finger attack). */
  readonly thump?: number;
  readonly seed: number;
}

/** Raw Karplus–Strong string, not normalised. */
export function renderString(o: PluckOptions, sr: number): Float32Array {
  const n = samples(o.duration, sr);
  const out = new Float32Array(n);
  const period = sr / o.freq;
  const bright = Math.min(1, Math.max(0, o.brightness));
  // Two-tap loop filter: s = 0.5 is the classic average (dark), s → 0 is bright.
  const s = 0.5 - 0.42 * bright;
  // Loop loss so the fundamental reaches −60 dB after t60.
  const loss = Math.pow(0.001, 1 / (o.freq * Math.max(0.05, o.t60)));

  // Excitation: one period of noise, low-passed by brightness, comb-filtered by pick position.
  const rng = new Rng(o.seed);
  const exLen = Math.max(4, Math.round(period));
  const ex = new Float32Array(exLen);
  for (let i = 0; i < exLen; i++) ex[i] = rng.next() * 2 - 1;
  onePoleLP(ex, 600 + 9000 * bright * bright, sr);
  const pick = Math.max(
    1,
    Math.round(Math.min(0.5, Math.max(0.02, o.pickPosition)) * exLen),
  );
  for (let i = exLen - 1; i >= pick; i--) ex[i] = ex[i]! - ex[i - pick]!;
  let mean = 0;
  for (let i = 0; i < exLen; i++) mean += ex[i]!;
  mean /= exLen;
  let exPeak = 1e-9;
  for (let i = 0; i < exLen; i++) {
    ex[i] = ex[i]! - mean;
    exPeak = Math.max(exPeak, Math.abs(ex[i]!));
  }
  for (let i = 0; i < exLen; i++) ex[i] = ex[i]! / exPeak;

  const twang = (o.twangCents ?? 0) / 1200;
  const twangTau = Math.max(1e-3, o.twangTime ?? 0.05) * sr;
  const glideEnd = twang !== 0 ? Math.min(n, Math.ceil(8 * twangTau)) : 0;
  const vib = o.vibrato;
  const vibStart = vib ? Math.round(vib.delay * sr) : n;
  const vibRamp = 0.4 * sr;
  for (let i = 0; i < n; i++) {
    let octaves = i < glideEnd ? twang * Math.exp(-i / twangTau) : 0;
    if (vib && i > vibStart) {
      const depth = Math.min(1, (i - vibStart) / vibRamp) * (vib.cents / 1200);
      octaves += depth * sinCycles(((i - vibStart) * vib.hz) / sr);
    }
    const glide = octaves !== 0 ? Math.pow(2, octaves) : 1;
    const delay = period / glide - s;
    const p = i - delay;
    let fb = 0;
    if (p >= 1)
      fb = loss * ((1 - s) * hermite(out, p) + s * hermite(out, p - 1));
    out[i] = (i < exLen ? ex[i]! : 0) + fb;
  }

  const thump = o.thump ?? 0;
  if (thump > 0) {
    const tau = 0.035 * sr;
    for (let i = 0; i < Math.min(n, Math.round(0.25 * sr)); i++) {
      out[i] =
        out[i]! +
        thump *
          sinCycles((i * o.freq) / sr) *
          Math.exp(-i / tau) *
          Math.min(1, i / (0.002 * sr));
    }
  }
  return out;
}

/**
 * Banjo: bright steel under a pick, near the bridge, short decay, a 3-cent
 * twang, and the ringing head (a bright presence bump, the pot's low boom
 * trimmed away).
 */
export function renderBanjo(
  freq: number,
  sr: number,
  seed: number,
): Float32Array {
  // Higher strings die sooner on a banjo head.
  const t60 = Math.min(1.5, Math.max(0.55, 1.5 - (freq - 150) / 900));
  const out = renderString(
    {
      freq,
      duration: 1.5,
      t60,
      brightness: 0.82,
      pickPosition: 0.13,
      twangCents: 3,
      twangTime: 0.04,
      seed,
    },
    sr,
  );
  biquad(out, "highpass", 110, 0.7, sr);
  biquad(out, "peaking", 2400, 1.1, sr, 5);
  biquad(out, "peaking", 480, 1.6, sr, 2.5);
  biquad(out, "lowpass", 9500, 0.7, sr);
  dcBlock(out, sr);
  fadeIn(out, 8);
  fadeOut(out, samples(0.06, sr));
  return limit(normalize(out, 0.9));
}

/**
 * Upright bass: dark gut string plucked by the side of a finger, with a
 * round thump at the attack and a warm body (boost ~110 Hz, gentle top cut).
 */
export function renderUprightBass(
  freq: number,
  sr: number,
  seed: number,
): Float32Array {
  const t60 = Math.min(2.4, Math.max(1.2, 2.6 - freq / 150));
  const out = renderString(
    {
      freq,
      duration: 2,
      t60,
      brightness: 0.18,
      pickPosition: 0.3,
      thump: 0.9,
      seed,
    },
    sr,
  );
  biquad(out, "lowpass", Math.min(2200, freq * 14), 0.8, sr);
  biquad(out, "peaking", 110, 1.2, sr, 3);
  biquad(out, "highpass", 32, 0.7, sr);
  dcBlock(out, sr);
  fadeIn(out, 16);
  fadeOut(out, samples(0.08, sr));
  return limit(normalize(out, 0.9));
}

/** Guzheng ring time: low strings sing for seconds, the top strings die sooner. */
export function guzhengT60(freq: number): number {
  return Math.min(5.2, Math.max(1.4, 5.2 - (freq - 150) / 330));
}

/**
 * Guzheng: steel strings plucked with a plectrum near the bridge. A bright
 * attack with a little nail "zing", a slight bend up into pitch (the string
 * settles as the plectrum leaves it), a long singing decay with a gentle
 * left-hand vibrato after ~0.35 s, and the long paulownia soundboard (warm
 * lows, a presence lift).
 */
export function renderGuzheng(
  freq: number,
  sr: number,
  seed: number,
  maxDuration = Infinity,
): Float32Array {
  const t60 = guzhengT60(freq);
  const duration = Math.min(3, t60 * 0.75 + 0.3, maxDuration);
  const out = renderString(
    {
      freq,
      duration,
      t60,
      brightness: 0.86,
      pickPosition: 0.11,
      twangCents: -14,
      twangTime: 0.03,
      vibrato: { hz: 5.2, cents: 6, delay: 0.35 },
      seed,
    },
    sr,
  );
  // Plectrum zing: a few milliseconds of bright noise on the attack.
  const rng = new Rng(seed ^ 0x5a5a);
  const zingN = Math.min(out.length, samples(0.006, sr));
  const zing = new Float32Array(zingN);
  for (let i = 0; i < zingN; i++)
    zing[i] = (rng.next() * 2 - 1) * Math.exp((-4 * i) / zingN);
  biquad(zing, "bandpass", Math.min(sr * 0.4, 5200), 1.3, sr);
  for (let i = 0; i < zingN; i++) out[i] = out[i]! + zing[i]! * 0.9;
  biquad(out, "highpass", 80, 0.7, sr);
  biquad(out, "peaking", 220, 1.2, sr, 2.5);
  biquad(out, "peaking", 3000, 1.0, sr, 4);
  biquad(out, "lowpass", Math.min(12000, sr * 0.45), 0.7, sr);
  dcBlock(out, sr);
  fadeIn(out, 6);
  fadeOut(out, samples(Math.min(0.25, duration * 0.2), sr));
  return limit(normalize(out, 0.9));
}

/**
 * Warm plucked bass: a dark string plucked by the side of a finger, with a
 * round thump at the attack and a soft body (boost ~110 Hz, the top rolled
 * off early) so it sits under the zither without clicking.
 */
export function renderBass(
  freq: number,
  sr: number,
  seed: number,
): Float32Array {
  const t60 = Math.min(2.4, Math.max(1.2, 2.6 - freq / 150));
  const out = renderString(
    {
      freq,
      duration: 2,
      t60,
      brightness: 0.14,
      pickPosition: 0.3,
      thump: 1.0,
      seed,
    },
    sr,
  );
  biquad(out, "lowpass", Math.min(1800, freq * 12), 0.75, sr);
  biquad(out, "peaking", 110, 1.2, sr, 3);
  biquad(out, "highpass", 32, 0.7, sr);
  dcBlock(out, sr);
  fadeIn(out, 16);
  fadeOut(out, samples(0.08, sr));
  return limit(normalize(out, 0.9));
}
