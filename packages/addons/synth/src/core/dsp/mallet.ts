/**
 * Struck bars, tines and bells: modal synthesis. Each partial is an
 * exponentially decaying sinusoid (a rotating phasor, no per-sample trig);
 * a short filtered-noise strike adds the mallet or tine click.
 * Presets: marimba (1 : 3.9 : 9.2), kalimba (1 : 5.4 : 8.9, slight detune),
 * glass bells (inharmonic, long), vibraphone (1 : 4 : 9.9, with the motor's
 * tremolo), a cast bell (hum, prime, tierce, quint, nominal) and metal
 * (anvil, clank, coins).
 */
import { biquad } from "./filters.js";
import { seededRandom } from "../random.js";
import {
  TWO_PI,
  dcBlock,
  fadeOut,
  limit,
  normalize,
  samples,
  sinCycles,
  requireNonNegative,
  requirePositive,
} from "./util.js";

export interface SynthModalPartial {
  /** Frequency ratio to the fundamental. */
  readonly ratio: number;
  /** Relative amplitude. */
  readonly amp: number;
  /** Seconds to decay by 60 dB. */
  readonly t60: number;
  /** Detune in cents (for beating pairs). */
  readonly cents?: number;
}

export interface SynthModalOptions {
  /** Fundamental in Hz; partial ratios multiply it. */
  readonly frequency: number;
  readonly duration: number;
  readonly partials: readonly SynthModalPartial[];
  /** Attack ramp in seconds (soft mallet ~3 ms, hard ~0.3 ms). */
  readonly attack: number;
  /** Strike noise level relative to the partial sum. */
  readonly strike: number;
  /** Centre frequency of the strike click (Hz). */
  readonly strikeFrequency: number;
  /** Strike click duration in seconds. */
  readonly strikeTime?: number;
  readonly seed: number;
}

/**
 * Struck-object tone from decaying partials plus a short strike click: bells,
 * mallets, gongs. Not normalised. Partials above 0.45 × sampleRate are skipped.
 */
export function renderModal(o: SynthModalOptions, sr: number): Float32Array {
  requirePositive("renderModal", {
    sampleRate: sr,
    frequency: o.frequency,
    duration: o.duration,
  });
  requireNonNegative("renderModal", { attack: o.attack });
  const out = new Float32Array(samples(o.duration, sr));
  const n = out.length;
  const attackN = Math.max(1, o.attack * sr);
  for (const p of o.partials) {
    const f = o.frequency * p.ratio * Math.pow(2, (p.cents ?? 0) / 1200);
    if (f >= sr * 0.45 || p.amp <= 0) continue;
    const w = (TWO_PI * f) / sr;
    const d = Math.pow(0.001, 1 / Math.max(1e-4, p.t60 * sr));
    const cw = Math.cos(w) * d;
    const sw = Math.sin(w) * d;
    let re = 1;
    let im = 0;
    const amp = p.amp;
    // Stop once the partial is inaudible (−80 dB).
    const stop = Math.min(n, Math.ceil(p.t60 * (80 / 60) * sr));
    for (let i = 0; i < stop; i++) {
      const a = i < attackN ? 0.5 - 0.5 * Math.cos((Math.PI * i) / attackN) : 1;
      out[i] = out[i]! + im * amp * a;
      const nr = re * cw - im * sw;
      im = re * sw + im * cw;
      re = nr;
      if ((i & 4095) === 4095) {
        // Renormalise the phasor so rounding never drifts the level.
        const mag = Math.hypot(re, im);
        const target = Math.pow(d, i + 1);
        if (mag > 0) {
          re = (re / mag) * target;
          im = (im / mag) * target;
        }
      }
    }
  }
  if (o.strike > 0) {
    const rng = seededRandom(o.seed);
    const len = Math.min(n, samples(o.strikeTime ?? 0.006, sr));
    const click = new Float32Array(len);
    for (let i = 0; i < len; i++)
      click[i] = (rng() * 2 - 1) * Math.exp((-5 * i) / len);
    biquad(click, "bandpass", o.strikeFrequency, 1.2, sr);
    // Match the click's level to the partial sum so `strike` is relative.
    let sum = 0;
    for (const p of o.partials) sum += p.amp;
    for (let i = 0; i < len; i++)
      out[i] = out[i]! + click[i]! * o.strike * sum * 3;
  }
  return out;
}

function finish(out: Float32Array, sr: number, tail = 0.05): Float32Array {
  dcBlock(out, sr);
  fadeOut(out, samples(tail, sr));
  return limit(normalize(out, 0.9));
}

/** Marimba: woody bar, partials 1 : 3.9 : 9.2, fast decay; low notes ring longer. */
export function renderMarimba(
  freq: number,
  sr: number,
  seed: number,
): Float32Array {
  const t60 = Math.min(1.6, Math.max(0.45, 1.7 - (freq - 130) / 700));
  const out = renderModal(
    {
      frequency: freq,
      duration: Math.min(1.4, t60 + 0.15),
      partials: [
        { ratio: 1, amp: 1, t60 },
        { ratio: 3.9, amp: 0.28, t60: t60 * 0.28 },
        { ratio: 9.2, amp: 0.08, t60: t60 * 0.1 },
        { ratio: 2.0, amp: 0.03, t60: t60 * 0.4 },
      ],
      attack: 0.0025,
      strike: 0.045,
      strikeFrequency: 2200,
      strikeTime: 0.008,
      seed,
    },
    sr,
  );
  biquad(out, "highpass", 70, 0.7, sr);
  return finish(out, sr);
}

/** Kalimba: glassy tine, partials 1 : 5.4 : 8.9, a slightly detuned twin for shimmer. */
export function renderKalimba(
  freq: number,
  sr: number,
  seed: number,
  maxDuration = Infinity,
): Float32Array {
  const t60 = Math.min(2.2, Math.max(0.9, 2.3 - (freq - 260) / 900));
  const out = renderModal(
    {
      frequency: freq,
      duration: Math.min(1.8, t60 * 0.8 + 0.2, maxDuration),
      partials: [
        { ratio: 1, amp: 1, t60 },
        { ratio: 1, amp: 0.3, t60: t60 * 0.8, cents: 4 },
        { ratio: 5.4, amp: 0.16, t60: t60 * 0.18 },
        { ratio: 8.9, amp: 0.07, t60: t60 * 0.08 },
        { ratio: 2, amp: 0.05, t60: t60 * 0.3 },
      ],
      attack: 0.0008,
      strike: 0.05,
      strikeFrequency: 3800,
      strikeTime: 0.004,
      seed,
    },
    sr,
  );
  biquad(out, "highpass", 120, 0.7, sr);
  biquad(out, "peaking", 350, 1, sr, 2); // the wooden box
  return finish(out, sr, 0.08);
}

/**
 * Glass bells: a dominant fundamental (with a beating twin) and a tuned
 * octave keep the pitch clear for melodies; weaker inharmonic partials
 * (2.76, 5.4, 8.93) give the crystal shimmer; long tail.
 */
export function renderGlassBell(
  freq: number,
  sr: number,
  seed: number,
  maxDuration = Infinity,
): Float32Array {
  const t60 = Math.min(3.4, Math.max(1.6, 3.6 - (freq - 400) / 700));
  const out = renderModal(
    {
      frequency: freq,
      duration: Math.min(3.0, t60 * 0.85, maxDuration),
      partials: [
        { ratio: 1, amp: 1, t60 },
        { ratio: 1, amp: 0.4, t60, cents: 3 },
        { ratio: 2, amp: 0.22, t60: t60 * 0.75 },
        { ratio: 2.76, amp: 0.16, t60: t60 * 0.5, cents: -4 },
        { ratio: 5.4, amp: 0.09, t60: t60 * 0.3 },
        { ratio: 8.93, amp: 0.045, t60: t60 * 0.16 },
      ],
      attack: 0.0006,
      strike: 0.025,
      strikeFrequency: 6000,
      strikeTime: 0.003,
      seed,
    },
    sr,
  );
  biquad(out, "highpass", 180, 0.7, sr);
  return finish(out, sr, 0.3);
}

/** Ring time of a vibraphone bar (motor off): the low bars sing for seconds. */
export function vibraphoneT60(freq: number): number {
  return Math.min(5.5, Math.max(1.4, 5.8 - (freq - 175) / 260));
}

/**
 * Vibraphone: aluminium bars tuned so the first overtone sits two octaves
 * up (4×) and the next near 10×, struck with soft yarn mallets; the tube
 * under each bar sustains the fundamental. `motorHz` spins the discs in the
 * tubes, so the fundamental pulses in a slow tremolo (0: the motor is off
 * and the bar rings still and glassy).
 */
export function renderVibraphone(
  freq: number,
  sr: number,
  seed: number,
  motorHz = 0,
  maxDuration = Infinity,
): Float32Array {
  const rng = seededRandom(seed);
  const t60 = vibraphoneT60(freq);
  const duration = Math.min(maxDuration, 3.6, 0.55 * t60 + 0.35);
  const body = renderModal(
    {
      frequency: freq,
      duration,
      partials: [{ ratio: 1, amp: 1, t60 }],
      attack: 0.0035,
      strike: 0,
      strikeFrequency: 1000,
      seed,
    },
    sr,
  );
  if (motorHz > 0) {
    // The discs open and close the tubes: the resonated fundamental swells and fades.
    const phase = rng();
    for (let i = 0; i < body.length; i++) {
      body[i] =
        body[i]! *
        (1 - 0.5 * (0.5 + 0.5 * sinCycles((motorHz * i) / sr + phase)));
    }
  }
  const out = renderModal(
    {
      frequency: freq,
      duration,
      partials: [
        { ratio: 4, amp: 0.2, t60: t60 * 0.22 },
        { ratio: 9.92, amp: 0.06, t60: t60 * 0.08 },
      ],
      attack: 0.0015,
      strike: 0.12,
      strikeFrequency: Math.min(sr * 0.4, 3000),
      strikeTime: 0.004,
      seed: seed + 1,
    },
    sr,
  );
  for (let i = 0; i < out.length; i++) out[i] = out[i]! + body[i]!;
  biquad(out, "highpass", 120, 0.7, sr);
  return finish(out, sr, Math.min(0.2, duration * 0.1));
}

/** Ring time of a cast bell: big low bells hum for seconds, small ones die sooner. */
export function bellT60(freq: number): number {
  return Math.min(4.5, Math.max(1.2, 4.8 - (freq - 260) / 300));
}

/**
 * A cast bell (a clock tower's chime, a tram's bell): a clear prime with a
 * beating twin so a tune reads, the hum an octave down, the minor-third
 * tierce, the quint and the nominal octave, a few inharmonic partials on
 * top and a bright metal strike.
 */
export function renderBell(
  freq: number,
  sr: number,
  seed: number,
  maxDuration = Infinity,
): Float32Array {
  const t60 = bellT60(freq);
  const out = renderModal(
    {
      frequency: freq,
      duration: Math.min(maxDuration, 4, 0.8 * t60 + 0.2),
      partials: [
        { ratio: 0.5, amp: 0.2, t60: t60 * 1.2 },
        { ratio: 1, amp: 1, t60 },
        { ratio: 1, amp: 0.35, t60: t60 * 0.9, cents: 3.5 },
        { ratio: 1.19, amp: 0.28, t60: t60 * 0.7 },
        { ratio: 1.5, amp: 0.2, t60: t60 * 0.6 },
        { ratio: 2, amp: 0.5, t60: t60 * 0.6, cents: -3 },
        { ratio: 2.51, amp: 0.16, t60: t60 * 0.4 },
        { ratio: 3.01, amp: 0.11, t60: t60 * 0.32 },
        { ratio: 4.2, amp: 0.07, t60: t60 * 0.24 },
        { ratio: 5.43, amp: 0.04, t60: t60 * 0.16 },
      ],
      attack: 0.0005,
      strike: 0.05,
      strikeFrequency: Math.min(sr * 0.4, freq * 5),
      strikeTime: 0.003,
      seed,
    },
    sr,
  );
  biquad(out, "highpass", Math.max(60, freq * 0.4), 0.7, sr);
  return finish(out, sr, 0.2);
}
