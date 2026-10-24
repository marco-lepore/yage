/**
 * Keyboards: a tine electric piano (a Rhodes-like suitcase), as two-operator
 * FM. The tine's body is a sine phase-modulated by its own frequency: a
 * high modulation index just after the hammer gives the bright, barking
 * attack, and as the index falls the tone rounds off to a nearly pure sine.
 * A second, quickly fading pair modulated at 14 times the pitch adds the
 * metallic "ding" of the tine, the pickup's slight asymmetry a little warmth,
 * the felt hammer a soft knock, and the speaker rolls off the top.
 */
import { biquad, onePoleLP } from "./filters.js";
import { seededRandom } from "../random.js";
import {
  TWO_PI,
  dcBlock,
  fadeOut,
  limit,
  normalize,
  samples,
  sinCycles,
  t60Coef,
} from "./util.js";

export interface ElectricPianoOptions {
  /** How hard the tine barks: 0 round and mellow, 1 a strong growl (default 0.6). */
  readonly bark?: number;
  /** Amplitude tremolo of the amp: [rate Hz, depth 0..1]. */
  readonly tremolo?: readonly [number, number];
  /** Slow pitch sway: [rate Hz, depth cents] (a warped, underwater wobble). */
  readonly wobble?: readonly [number, number];
  /** Speaker low-pass (Hz, default 5200; lower is darker). */
  readonly tone?: number;
  /** Longest render (s). */
  readonly maxDuration?: number;
}

/** Ring time of the tine: low notes sing for seconds, the top of the keyboard dies sooner. */
export function electricPianoT60(freq: number): number {
  return Math.min(7, Math.max(2.2, 8 - (freq - 65) / 120));
}

export function renderElectricPiano(
  freq: number,
  sr: number,
  seed: number,
  o: ElectricPianoOptions = {},
): Float32Array {
  const rng = seededRandom(seed);
  const t60 = electricPianoT60(freq);
  const duration = Math.min(o.maxDuration ?? Infinity, 3.4, 0.45 * t60 + 0.6);
  const n = samples(duration, sr);
  const out = new Float32Array(n);

  // Two-stage decay: part of the swing dies quickly after the strike, the rest rings on.
  const kSlow = t60Coef(t60, sr);
  const kFast = t60Coef(Math.min(0.9, 0.15 * t60), sr);
  // The body's modulation index (in cycles): high at the strike, falling to a gentle floor.
  const bark = Math.min(1, Math.max(0, o.bark ?? 0.6));
  const indexPeak = (0.9 + 1.5 * bark) / TWO_PI;
  const indexFloor = 0.35 / TWO_PI;
  // Low notes keep their growl longer.
  const kIndex = Math.exp(-1 / (Math.min(0.6, 0.12 + 30 / freq) * sr));
  // The tine's ding: carrier at pitch, modulator at 14×, gone in a few tens of milliseconds.
  const dingOn = freq * 15 < sr * 0.45;
  const kDing = Math.exp(-1 / (Math.min(0.12, 0.03 + 6 / freq) * sr));
  const dingIndex = 0.9 / TWO_PI;
  const attackN = Math.max(1, Math.round(0.0015 * sr));
  const wobRate = o.wobble ? o.wobble[0] / sr : 0;
  const wobCents = o.wobble ? o.wobble[1] : 0;
  const wobPhase = rng();

  let slow = 1;
  let fast = 1;
  let index = 1;
  let ding = 1;
  let p = rng();
  for (let i = 0; i < n; i++) {
    const a = i < attackN ? 0.5 - 0.5 * Math.cos((Math.PI * i) / attackN) : 1;
    const body = sinCycles(
      p + (indexFloor + (indexPeak - indexFloor) * index) * sinCycles(p),
    );
    let v = (0.7 * slow + 0.3 * fast) * body;
    if (dingOn) v += 0.35 * ding * sinCycles(p + dingIndex * sinCycles(14 * p));
    // The pickup sits a little off the tine's centre: a touch of even harmonics.
    out[i] = a * (v + 0.12 * v * v);
    const bend =
      wobCents !== 0
        ? Math.pow(2, (wobCents * sinCycles(wobRate * i + wobPhase)) / 1200)
        : 1;
    p += (freq * bend) / sr;
    if (p >= 1) p -= 1;
    slow *= kSlow;
    fast *= kFast;
    index *= kIndex;
    ding *= kDing;
  }

  // The felt hammer: a soft, dark knock under the attack.
  const knockN = Math.min(n, samples(0.008, sr));
  const knock = new Float32Array(knockN);
  for (let i = 0; i < knockN; i++)
    knock[i] = (rng() * 2 - 1) * Math.exp((-5 * i) / knockN);
  onePoleLP(knock, Math.min(2400, freq * 6), sr);
  for (let i = 0; i < knockN; i++) out[i] = out[i]! + 0.2 * knock[i]!;

  // The suitcase: a little low-mid warmth, the speaker's roll-off, no rumble.
  dcBlock(out, sr);
  biquad(out, "peaking", 220, 0.9, sr, 1.5);
  biquad(out, "lowpass", Math.min(o.tone ?? 5200, sr * 0.45), 0.7, sr);
  biquad(out, "highpass", 45, 0.7, sr);

  if (o.tremolo) {
    const [hz, depth] = o.tremolo;
    const ph = rng();
    for (let i = 0; i < n; i++)
      out[i] =
        out[i]! * (1 - depth * (0.5 + 0.5 * sinCycles((hz * i) / sr + ph)));
  }
  fadeOut(out, samples(Math.min(0.25, duration * 0.15), sr));
  return limit(normalize(out, 0.9));
}
