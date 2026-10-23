/**
 * Seeded percussion renderers for kick, brushes, rim, shaker, clap, tom,
 * ride and cymbal.
 */
import { biquad, svf } from "./filters.js";
import { renderModal } from "./mallet.js";
import { whiteNoise } from "./noise.js";
import { seededRandom } from "../random.js";
import {
  dcBlock,
  fadeOut,
  limit,
  normalize,
  polyBlep,
  samples,
  saturate,
  sinCycles,
  t60Coef,
  requirePositive,
} from "./util.js";

/** MIDI pitch the low tom sounds at; `tom` registers it as its root note. */
export const LOW_TOM_ROOT = 43;

function finish(out: Float32Array, sr: number, tail = 0.02): Float32Array {
  dcBlock(out, sr);
  fadeOut(out, samples(tail, sr));
  return limit(normalize(out, 0.9));
}

/** Sine with an exponential pitch sweep from f0 to f1 and a decay envelope. */
function sweptSine(
  out: Float32Array,
  sr: number,
  f0: number,
  f1: number,
  sweepTau: number,
  t60: number,
  gain: number,
  attack = 0.001,
): void {
  const sweepK = Math.exp(-1 / (sweepTau * sr));
  const decayK = t60Coef(t60, sr);
  const attackN = Math.max(1, attack * sr);
  let sweep = 1;
  let decay = 1;
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const f = f1 + (f0 - f1) * sweep;
    out[i] =
      out[i]! +
      gain * (i < attackN ? i / attackN : 1) * decay * sinCycles(phase);
    phase += f / sr;
    if (phase >= 1) phase -= 1;
    sweep *= sweepK;
    decay *= decayK;
  }
}

function decayingNoise(
  n: number,
  sr: number,
  seed: number,
  attack: number,
  t60: number,
): Float32Array {
  const out = whiteNoise(n, seed);
  const decayK = t60Coef(t60, sr);
  const attackN = Math.max(1, attack * sr);
  let decay = 1;
  for (let i = 0; i < n; i++) {
    out[i] = out[i]! * (i < attackN ? i / attackN : 1) * decay;
    decay *= decayK;
  }
  return out;
}

/** Membrane drum: three modes with a small pitch drop at the strike, plus a stick/beater noise. */
function membrane(
  sr: number,
  seed: number,
  o: {
    readonly freq: number;
    readonly seconds: number;
    readonly t60: readonly [number, number, number];
    readonly bend: number;
    readonly stickHz: number;
    readonly stick: number;
    readonly drive: number;
    /** Attack ramp (s, default 1.5 ms). */
    readonly attack?: number;
    /** Stick noise length and decay (s, defaults 25 ms and 18 ms). */
    readonly stickLength?: number;
    readonly stickT60?: number;
  },
): Float32Array {
  const n = samples(o.seconds, sr);
  const out = new Float32Array(n);
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  let d1 = 1;
  let d2 = 1;
  let d3 = 1;
  let bendE = 1;
  const k1 = t60Coef(o.t60[0], sr);
  const k2 = t60Coef(o.t60[1], sr);
  const k3 = t60Coef(o.t60[2], sr);
  const kb = Math.exp(-1 / (0.025 * sr));
  const attackN = Math.max(1, (o.attack ?? 0.0015) * sr);
  for (let i = 0; i < n; i++) {
    const bend = 1 + o.bend * bendE;
    const env = i < attackN ? i / attackN : 1;
    out[i] =
      env *
      (d1 * sinCycles(p1) +
        0.35 * d2 * sinCycles(p2) +
        0.15 * d3 * sinCycles(p3));
    p1 += (o.freq * bend) / sr;
    p2 += (o.freq * 1.59 * bend) / sr;
    p3 += (o.freq * 2.14 * bend) / sr;
    d1 *= k1;
    d2 *= k2;
    d3 *= k3;
    bendE *= kb;
  }
  const stick = decayingNoise(
    samples(o.stickLength ?? 0.025, sr),
    sr,
    seed,
    0.0005,
    o.stickT60 ?? 0.018,
  );
  biquad(stick, "lowpass", o.stickHz, 0.7, sr);
  for (let i = 0; i < stick.length; i++) out[i] = out[i]! + stick[i]! * o.stick;
  saturate(out, o.drive);
  return out;
}

/** Felt-beater bass drum: round sine thump with a soft beater click. */
export function renderKick(sr: number, seed: number): Float32Array {
  const rng = seededRandom(seed);
  const n = samples(0.5, sr);
  const out = new Float32Array(n);
  sweptSine(
    out,
    sr,
    96 * (1 + 0.04 * (rng() - 0.5)),
    50,
    0.03,
    0.42 + 0.06 * rng(),
    1,
    0.0015,
  );
  const click = decayingNoise(samples(0.012, sr), sr, seed + 1, 0.0005, 0.008);
  biquad(click, "lowpass", 2600, 0.7, sr);
  for (let i = 0; i < click.length; i++) out[i] = out[i]! + click[i]! * 0.35;
  saturate(out, 1.4);
  return finish(out, sr, 0.05);
}

/** Brush tap on a snare: soft wire hiss over a faint drum-head tone. `ghost` is shorter and darker. */
export function renderBrushTap(
  sr: number,
  seed: number,
  ghost: boolean,
): Float32Array {
  const rng = seededRandom(seed);
  const n = samples(ghost ? 0.16 : 0.32, sr);
  const hiss = decayingNoise(
    n,
    sr,
    seed,
    0.002,
    ghost ? 0.08 : 0.2 + 0.04 * rng(),
  );
  biquad(hiss, "bandpass", ghost ? 3600 : 4400 + 600 * rng(), 0.7, sr);
  biquad(hiss, "highpass", 1400, 0.7, sr);
  const wires = decayingNoise(n, sr, seed + 7, 0.001, ghost ? 0.06 : 0.12);
  biquad(wires, "bandpass", 7500, 1.2, sr);
  const out = new Float32Array(n);
  sweptSine(out, sr, 205, 185, 0.02, ghost ? 0.05 : 0.09, 0.22);
  for (let i = 0; i < n; i++)
    out[i] = out[i]! + hiss[i]! * 1.2 + wires[i]! * 0.5;
  return finish(out, sr, 0.03);
}

/** Brush swirl: a circular sweep across the head (swells then fades). */
export function renderBrushSwish(sr: number, seed: number): Float32Array {
  const dur = 0.55;
  const n = samples(dur, sr);
  const out = whiteNoise(n, seed);
  svf(out, "band", (t) => 2600 + 2200 * Math.sin((Math.PI * t) / dur), 1.1, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env =
      Math.pow(Math.sin((Math.PI * Math.min(t, dur)) / dur), 1.6) *
      (1 - (0.35 * t) / dur);
    const bristle = 0.8 + 0.2 * sinCycles(7 * t);
    out[i] = out[i]! * env * bristle;
  }
  return finish(out, sr, 0.03);
}

/** Cross-stick rim click: a woody knock and a bright rim ping. */
export function renderRim(sr: number, seed: number): Float32Array {
  const rng = seededRandom(seed);
  const out = renderModal(
    {
      frequency: 420 * (1 + 0.03 * (rng() - 0.5)),
      duration: 0.14,
      partials: [
        { ratio: 1, amp: 0.8, t60: 0.07 },
        { ratio: 3.93, amp: 0.9, t60: 0.045 },
        { ratio: 5.9, amp: 0.3, t60: 0.03 },
      ],
      attack: 0.0003,
      strike: 0.3,
      strikeFrequency: 2600,
      strikeTime: 0.003,
      seed,
    },
    sr,
  );
  return finish(out, sr, 0.01);
}

/** Egg shaker: grainy high noise with a short roll-in. */
export function renderShaker(sr: number, seed: number): Float32Array {
  const rng = seededRandom(seed);
  const n = samples(0.14, sr);
  const out = whiteNoise(n, seed);
  const attack = 0.008 + 0.008 * rng();
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const grain = rng() < 0.35 ? 1 : 0.45;
    out[i] =
      out[i]! *
      grain *
      (t < attack ? t / attack : 1) *
      Math.pow(0.001, (t - attack) / 0.09);
  }
  biquad(out, "highpass", 4500, 0.7, sr);
  biquad(out, "peaking", 7500, 1, sr, 3);
  return finish(out, sr, 0.01);
}

/** Hand clap: a few players (each 3 quick bursts then a short tail). */
export function renderClap(sr: number, seed: number): Float32Array {
  const rng = seededRandom(seed);
  const n = samples(0.34, sr);
  const out = new Float32Array(n);
  const players = 3;
  for (let p = 0; p < players; p++) {
    const offset = p === 0 ? 0 : 0.004 + 0.012 * rng();
    const centre = 1100 + 900 * rng();
    const layer = new Float32Array(n);
    const noise = whiteNoise(n, seed + 31 * (p + 1));
    const bursts = [0, 0.008 + 0.003 * rng(), 0.018 + 0.004 * rng()];
    for (let i = 0; i < n; i++) {
      const t = i / sr - offset;
      if (t < 0) continue;
      let env = 0;
      for (const b of bursts) {
        const u = t - b;
        if (u >= 0 && u < 0.012) env = Math.max(env, Math.exp(-u / 0.0025));
      }
      const last = bursts[bursts.length - 1]!;
      if (t >= last)
        env = Math.max(env, 0.7 * Math.pow(0.001, (t - last) / 0.2));
      layer[i] = noise[i]! * env;
    }
    biquad(layer, "bandpass", centre, 1.3, sr);
    for (let i = 0; i < n; i++)
      out[i] = out[i]! + layer[i]! * (p === 0 ? 1 : 0.7);
  }
  biquad(out, "highpass", 500, 0.7, sr);
  return finish(out, sr, 0.03);
}

/** Tuned low tom (rendered at LOW_TOM_ROOT): membrane modes with a small pitch drop and a stick click. */
export function renderLowTom(sr: number, seed: number): Float32Array {
  const out = membrane(sr, seed, {
    freq: 440 * Math.pow(2, (LOW_TOM_ROOT - 69) / 12),
    seconds: 0.7,
    t60: [0.55, 0.25, 0.14],
    bend: 0.22,
    stickHz: 1800,
    stick: 0.4,
    drive: 1.2,
    attack: 0.001,
    stickLength: 0.02,
    stickT60: 0.015,
  });
  return finish(out, sr, 0.05);
}

/** Options for `renderMetal`. The optional levels default to the cymbal's mix. */
export interface SynthMetalOptions {
  /** Seconds. */
  readonly duration: number;
  /** Seconds to decay by 60 dB. */
  readonly t60: number;
  /** Multiplier on the six square-wave frequencies. The cymbal uses 1.7, the ride 1.3. */
  readonly frequencyScale: number;
  readonly seed: number;
  /** White noise level. Default 0.6. */
  readonly noise?: number;
  /** Level of the six squares. Default 0.12. */
  readonly squares?: number;
  /** Attack ramp in seconds. Default 0.001. */
  readonly attack?: number;
}

/**
 * Metallic noise: six detuned band-limited squares (205.3 … 800 Hz ×
 * `frequencyScale`) plus white noise, decaying. Cymbals and hi-hats. Not
 * normalised.
 */
export function renderMetal(o: SynthMetalOptions, sr: number): Float32Array {
  requirePositive("renderMetal", {
    sampleRate: sr,
    duration: o.duration,
    t60: o.t60,
    frequencyScale: o.frequencyScale,
  });
  const { duration, t60, seed } = o;
  const freqScale = o.frequencyScale;
  const noiseLevel = o.noise ?? 0.6;
  const squareLevel = o.squares ?? 0.12;
  const attackN = (o.attack ?? 0.001) * sr;
  const n = samples(duration, sr);
  const out = whiteNoise(n, seed);
  const rng = seededRandom(seed);
  const freqs = [205.3, 304.4, 369.6, 522.7, 540, 800].map(
    (f) => f * freqScale * (1 + 0.01 * (rng() - 0.5)),
  );
  const phases = freqs.map(() => rng());
  const decayK = t60Coef(t60, sr);
  let decay = 1;
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let k = 0; k < freqs.length; k++) {
      const dt = freqs[k]! / sr;
      let p = phases[k]!;
      let q = p + 0.5;
      if (q >= 1) q -= 1;
      v += 2 * p - 1 - polyBlep(p, dt) - (2 * q - 1 - polyBlep(q, dt));
      p += dt;
      if (p >= 1) p -= 1;
      phases[k] = p;
    }
    out[i] =
      (out[i]! * noiseLevel + v * squareLevel) *
      Math.min(1, i / attackN) *
      decay;
    decay *= decayK;
  }
  return out;
}

/** Cymbal: a bright wash, high-passed. */
export function renderCymbal(
  sr: number,
  seed: number,
  duration = 2,
  t60 = 1.6,
): Float32Array {
  const out = renderMetal({ duration, t60, frequencyScale: 1.7, seed }, sr);
  biquad(out, "highpass", 5200, 0.7, sr);
  biquad(out, "peaking", 9000, 0.8, sr, 3);
  return finish(out, sr, 0.1);
}

/**
 * Jazz ride cymbal: the stick's bright, glassy ping over a long, darker
 * wash that shimmers on after it.
 */
export function renderRide(
  sr: number,
  seed: number,
  duration = 2.4,
): Float32Array {
  const rng = seededRandom(seed);
  const wash = renderMetal(
    { duration, t60: 4.5, frequencyScale: 1.3, seed },
    sr,
  );
  biquad(wash, "highpass", 2400, 0.7, sr);
  biquad(wash, "peaking", 5200, 0.8, sr, 2);
  biquad(wash, "lowpass", Math.min(11000, sr * 0.45), 0.7, sr);
  const ping = renderModal(
    {
      frequency: 2950 * (1 + 0.02 * (rng() - 0.5)),
      duration,
      partials: [
        { ratio: 1, amp: 1, t60: 0.6 },
        { ratio: 1.41, amp: 0.5, t60: 0.45, cents: 8 },
        { ratio: 1.83, amp: 0.45, t60: 0.38 },
        { ratio: 2.37, amp: 0.3, t60: 0.3 },
        { ratio: 2.96, amp: 0.2, t60: 0.22 },
      ],
      attack: 0.0004,
      strike: 0.3,
      strikeFrequency: Math.min(sr * 0.4, 8000),
      strikeTime: 0.002,
      seed: seed + 3,
    },
    sr,
  );
  normalize(wash, 1);
  normalize(ping, 1);
  const out = new Float32Array(wash.length);
  for (let i = 0; i < out.length; i++)
    out[i] = 0.55 * wash[i]! + 0.6 * ping[i]!;
  return finish(out, sr, 0.15);
}
