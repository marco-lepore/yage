import { seededRandom } from "../random.js";
import { sinCycles, normalize, prepareTonalLoop } from "./util.js";
import type { SynthRenderLoop } from "../defineInstrument.js";

interface AdditiveNote {
  readonly frequency: number;
  readonly duration: number;
  readonly sampleRate?: number;
  readonly velocity?: number;
  readonly seed?: number;
  readonly harmonics: readonly number[];
  readonly breath: boolean;
}

function smooth(value: number): number {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
}

/** Harmonic oscillators with authored envelopes and feedforward breath noise. */
function renderAdditiveNote({
  frequency,
  duration,
  sampleRate = 44100,
  velocity = 0.65,
  seed = 1,
  harmonics: harmonicWeights,
  breath: hasBreath,
}: AdditiveNote): Float32Array {
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 96000 ||
    !Number.isFinite(frequency) ||
    frequency < 20 ||
    frequency > Math.min(4000, sampleRate / 4) ||
    !Number.isFinite(duration) ||
    duration < 0.1 ||
    duration > 30 ||
    !Number.isFinite(velocity) ||
    velocity < 0 ||
    velocity > 1 ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff
  ) {
    throw new Error(
      `renderAdditive: expected sampleRate 8000–96000, frequency 20–min(4000, sampleRate/4) and a uint32 seed, got sampleRate ${sampleRate}, frequency ${frequency}, seed ${seed}.`,
    );
  }
  const rng = seededRandom(seed);
  const output = new Float32Array(Math.round(duration * sampleRate));
  const harmonics = harmonicWeights
    .map((weight, i) => ({
      order: i + 1,
      weight:
        weight * Math.exp(-(((i * frequency) / (3200 + 1400 * velocity)) ** 2)),
    }))
    .filter(({ order }) => order * frequency < sampleRate * 0.45);
  const attack = 0.045 - 0.018 * velocity;
  const release = Math.min(0.1, duration / 4);
  const vibratoPhase = rng();
  const wanderSpan = Math.max(1, Math.round(sampleRate * 0.09));
  let previousWander = rng() * 2 - 1;
  let nextWander = rng() * 2 - 1;
  let phase = 0;

  // Difference of two moving averages gives finite-duration noise filtering.
  const fastLength = Math.max(2, Math.round(sampleRate / 11025));
  const slowLength = Math.max(fastLength + 1, Math.round(sampleRate / 1800));
  const noiseHistory = new Float64Array(slowLength);
  const noiseGain = 1 / Math.sqrt((1 / fastLength - 1 / slowLength) / 3);
  let fastSum = 0;
  let slowSum = 0;
  let write = 0;
  for (let i = 0; i < output.length; i++) {
    const t = i / sampleRate;
    if (i > 0 && i % wanderSpan === 0) {
      previousWander = nextWander;
      nextWander = rng() * 2 - 1;
    }
    const wander =
      previousWander +
      (nextWander - previousWander) * smooth((i % wanderSpan) / wanderSpan);
    const vibrato = sinCycles(5.1 * t + vibratoPhase);
    const vibratoFade = smooth((t - 0.15) / 0.3);
    const cents = !hasBreath
      ? 0
      : 0.9 * wander +
        (6 + 4 * velocity) * vibratoFade * vibrato -
        3 * Math.exp(-t / 0.025);
    phase = (phase + (frequency / sampleRate) * 2 ** (cents / 1200)) % 1;

    let tone = 0;
    for (const { order, weight } of harmonics) {
      const partialAttack = smooth(t / (attack * (1 + 0.12 * (order - 1))));
      const partialBrightness = 1 + 0.09 * (order - 1) * vibratoFade * vibrato;
      tone +=
        weight * partialAttack * partialBrightness * sinCycles(order * phase);
    }

    const noise = rng() * 2 - 1;
    const fastRead = (write - fastLength + slowLength) % slowLength;
    fastSum += noise - noiseHistory[fastRead]!;
    slowSum += noise - noiseHistory[write]!;
    noiseHistory[write] = noise;
    write = (write + 1) % slowLength;
    const air = (fastSum / fastLength - slowSum / slowLength) * noiseGain;
    const breathEnvelope = smooth(t / 0.012);
    const onsetBreath = 0.035 * Math.exp(-t / 0.045);
    const sustainedBreath = 0.009 + 0.007 * velocity;
    const breath = !hasBreath
      ? 0
      : air *
        breathEnvelope *
        (onsetBreath + sustainedBreath) *
        (0.82 + 0.18 * sinCycles(phase));
    const releaseEnvelope = smooth(
      (output.length - 1 - i) / (sampleRate * release),
    );
    const breathMotion = 1 + 0.012 * wander + 0.015 * vibratoFade * vibrato;
    output[i] =
      0.42 *
      velocity ** 0.55 *
      releaseEnvelope *
      breathMotion *
      (tone + breath);
  }
  return output;
}

/** Options for `renderAdditive`. */
export interface SynthAdditiveOptions {
  /** Fundamental in Hz. */
  readonly frequency: number;
  readonly seed: number;
  /** Relative amplitude of harmonic 1, 2, 3, … */
  readonly harmonics: readonly number[];
  /** Breath noise, vibrato and pitch wander, as in a wind instrument. False for an organ. */
  readonly breath: boolean;
}

/**
 * A two-second sustained note built from harmonics, with a phase-matched
 * sustain loop in sample indices. Normalised to 0.9.
 */
export function renderAdditive(
  { frequency, seed, harmonics, breath }: SynthAdditiveOptions,
  sampleRate: number,
): SynthRenderLoop {
  const data = renderAdditiveNote({
    harmonics,
    breath,
    frequency,
    sampleRate,
    seed,
    duration: 2,
  });
  const loopStart = Math.round(0.6 * sampleRate);
  const loopEnd = prepareTonalLoop(
    data,
    sampleRate,
    loopStart,
    Math.round(1.8 * sampleRate),
    frequency,
    Math.round(0.04 * sampleRate),
  );
  normalize(data, 0.9);
  return { samples: data, loopStart, loopEnd };
}
