import type {
  SynthFilter,
  SynthJingle,
  SynthPatch,
  SynthSound,
  SynthWave,
} from "./types.js";

/** Sample rate used when a caller doesn't pass one. */
export const SYNTH_SAMPLE_RATE = 44100;

/** Longest tail crossfaded into the head of a `seamless` patch, in seconds. */
const MAX_SEAMLESS_FADE = 0.05;

/** Peak level a patch renders at when it doesn't set one. */
const DEFAULT_VOLUME = 0.3;

/**
 * Render one voice to mono samples in [-1, 1].
 *
 * Pure math: no WebAudio, no `Math.random`, no engine imports. The same patch
 * and sample rate always give the same samples, so a patch can be unit-tested
 * by asserting on the array. Output length is
 * `(delay + duration) * sampleRate`, minus the crossfade for a `seamless`
 * patch.
 */
export function renderSynthPatch(
  patch: SynthPatch,
  sampleRate: number = SYNTH_SAMPLE_RATE,
): Float32Array {
  assertPositive("sampleRate", sampleRate);
  const duration = patch.duration ?? 0.2;
  assertPositive("duration", duration);
  const delay = patch.delay ?? 0;
  assertAtLeast("delay", delay, 0);
  const volume = patch.volume ?? DEFAULT_VOLUME;
  assertAtLeast("volume", volume, 0);
  const noiseMix = patch.noise ?? 0;
  assertAtLeast("noise", noiseMix, 0);
  if (noiseMix > 1) throw rangeError("noise", noiseMix, "at most 1");
  const rawAttack = patch.attack ?? 0.005;
  assertAtLeast("attack", rawAttack, 0);
  const curve = patch.curve ?? 3;
  assertAtLeast("curve", curve, 0);

  const seamless = patch.seamless === true;
  if (seamless && delay > 0) {
    throw new Error(
      "renderSynthPatch: a seamless patch cannot take a delay — the leading " +
        "silence would sit inside the loop. Layer the delay outside the " +
        "seamless voice instead.",
    );
  }

  const wave = patch.wave ?? "sine";
  const startFreq = patch.frequency ?? 440;
  const endFreq = patch.glideTo ?? startFreq;
  if (wave !== "noise") {
    // The glide is an exponential ratio walk, so both endpoints must be
    // positive pitches.
    assertPositive("frequency", startFreq);
    assertPositive("glideTo", endFreq);
  }
  if (patch.filter) {
    assertPositive("filter.frequency", patch.filter.frequency);
    if (patch.filter.sweepTo !== undefined) {
      assertPositive("filter.sweepTo", patch.filter.sweepTo);
    }
    if (patch.filter.q !== undefined) assertPositive("filter.q", patch.filter.q);
  }

  const voiceLength = Math.max(1, Math.round(duration * sampleRate));
  const offset = Math.round(delay * sampleRate);
  const out = new Float32Array(offset + voiceLength);
  const attack = Math.min(rawAttack, duration);
  const attackSamples = Math.min(
    Math.round(attack * sampleRate),
    voiceLength,
  );
  const glide = wave === "noise" ? 1 : endFreq / startFreq;

  const random = createRandom(patch.seed ?? 1);
  const filter = patch.filter ? createFilter(patch.filter, sampleRate) : null;

  let phase = 0;
  for (let i = 0; i < voiceLength; i++) {
    const progress = i / voiceLength;
    phase += (startFreq * glide ** progress) / sampleRate;
    phase -= Math.floor(phase);

    let sample =
      wave === "noise" ? random() * 2 - 1 : oscillate(wave, phase);
    if (noiseMix > 0 && wave !== "noise") {
      sample += (random() * 2 - 1 - sample) * noiseMix;
    }
    if (filter) sample = filter(sample, progress);

    const level = seamless
      ? 1
      : envelopeAt(i, attackSamples, voiceLength, curve);
    out[offset + i] = clamp(sample * level * volume);
  }

  if (!seamless) return out;

  // Loop-clean: fold the tail back over the head so the buffer's end meets
  // its start, then drop the folded tail.
  const fade = Math.min(
    Math.round(MAX_SEAMLESS_FADE * sampleRate),
    Math.floor(voiceLength / 4),
  );
  if (fade <= 1) return out;
  const kept = voiceLength - fade;
  for (let i = 0; i < fade; i++) {
    // Equal-power weights, endpoint-inclusive: the first blended sample is
    // tail-only (it continues the loop's end) and the last is head-only.
    // The two halves are uncorrelated noise, which a linear fade would dip
    // by 3 dB in the middle; the equal-power sum can exceed 1, so re-clamp.
    const w = i / (fade - 1);
    out[i] = clamp(
      (out[i] ?? 0) * Math.sqrt(w) + (out[kept + i] ?? 0) * Math.sqrt(1 - w),
    );
  }
  return out.slice(0, kept);
}

/**
 * Render a note sequence into one buffer. Each note is the jingle's `voice`
 * at that pitch; notes overlap when `noteSpacing` is shorter than
 * `noteDuration`.
 */
export function renderSynthJingle(
  jingle: SynthJingle,
  sampleRate: number = SYNTH_SAMPLE_RATE,
): Float32Array {
  const noteDuration = jingle.noteDuration ?? 0.16;
  const spacing = jingle.noteSpacing ?? noteDuration;
  assertAtLeast("noteSpacing", spacing, 0);
  const voice = jingle.voice ?? {};

  // Every entry — rests included — claims its slot on the timeline, so a
  // trailing rest still stretches the buffer.
  let timeline = 0;
  const parts: Array<{ samples: Float32Array; offset: number }> = [];
  jingle.notes.forEach((entry, index) => {
    const note = typeof entry === "number" ? { frequency: entry } : entry;
    const offset = Math.round(index * spacing * sampleRate);
    const duration = note.duration ?? noteDuration;
    timeline = Math.max(
      timeline,
      offset + Math.max(1, Math.round(duration * sampleRate)),
    );
    if (note.frequency <= 0) return; // a rest
    const patch: SynthPatch = {
      ...voice,
      frequency: note.frequency,
      duration,
      volume: (voice.volume ?? DEFAULT_VOLUME) * (note.volume ?? 1),
    };
    parts.push({ samples: renderSynthPatch(patch, sampleRate), offset });
  });

  return mix(parts, timeline);
}

/** Render a patch, a stack of layered patches, or a jingle. */
export function renderSynthSound(
  sound: SynthSound,
  sampleRate: number = SYNTH_SAMPLE_RATE,
): Float32Array {
  if (isPatchStack(sound)) {
    return mix(
      sound.map((patch) => ({
        samples: renderSynthPatch(patch, sampleRate),
        offset: 0,
      })),
    );
  }
  if ("notes" in sound) return renderSynthJingle(sound, sampleRate);
  return renderSynthPatch(sound, sampleRate);
}

/**
 * Whether a sound is layered voices. `Array.isArray` alone doesn't narrow a
 * `readonly` array out of the union, so the check goes through here.
 * @internal
 */
export function isPatchStack(sound: SynthSound): sound is readonly SynthPatch[] {
  return Array.isArray(sound);
}

function mix(
  parts: Array<{ samples: Float32Array; offset: number }>,
  minLength = 0,
): Float32Array {
  let length = minLength;
  for (const part of parts) {
    length = Math.max(length, part.offset + part.samples.length);
  }
  const out = new Float32Array(Math.max(length, 1));
  for (const part of parts) {
    for (let i = 0; i < part.samples.length; i++) {
      const at = part.offset + i;
      out[at] = (out[at] ?? 0) + (part.samples[i] ?? 0);
    }
  }
  // Clamp once the whole sum is in, so layer order can't change the result.
  for (let i = 0; i < out.length; i++) out[i] = clamp(out[i] ?? 0);
  return out;
}

function oscillate(wave: Exclude<SynthWave, "noise">, phase: number): number {
  switch (wave) {
    case "sine":
      return Math.sin(phase * Math.PI * 2);
    case "square":
      return phase < 0.5 ? 1 : -1;
    case "sawtooth":
      return phase * 2 - 1;
    case "triangle":
      return 1 - Math.abs(phase - 0.5) * 4;
  }
}

/**
 * Attack ramp, then an exponential release, in sample space so the final
 * sample of the voice is exactly 0 — an envelope that ends above zero clicks.
 * When the attack fills the whole voice there is no release left: the ramp
 * runs to the end and only the final sample is forced silent.
 */
function envelopeAt(
  i: number,
  attackSamples: number,
  total: number,
  curve: number,
): number {
  const last = total - 1;
  if (last <= attackSamples) return i >= last ? 0 : i / attackSamples;
  if (i < attackSamples) return i / attackSamples;
  const u = (i - attackSamples) / (last - attackSamples);
  if (curve < 1e-6) return 1 - u;
  const floor = Math.exp(-curve);
  return (Math.exp(-curve * u) - floor) / (1 - floor);
}

/**
 * State-variable filter, evaluated per sample. `progress` (0 to 1) drives the
 * cutoff sweep. Cutoff is capped at a third of the sample rate; the
 * recurrence runs twice per sample at double the rate, because at the single
 * rate the state variables blow up to NaN well below that cap.
 */
function createFilter(
  spec: SynthFilter,
  sampleRate: number,
): (input: number, progress: number) => number {
  const start = Math.max(spec.frequency, 10);
  const end = Math.max(spec.sweepTo ?? spec.frequency, 10);
  const sweep = end / start;
  // Resonance is clamped: below 0.5 the recurrence over-damps; far above 10
  // it stops damping at all and rings toward instability.
  const damping = 1 / Math.min(Math.max(spec.q ?? 1, 0.5), 10);
  const maxCutoff = sampleRate / 3;
  const innerRate = sampleRate * 2;
  let low = 0;
  let band = 0;
  return (input, progress) => {
    const cutoff = Math.min(start * sweep ** progress, maxCutoff);
    const f = 2 * Math.sin((Math.PI * cutoff) / innerRate);
    let high = 0;
    for (let step = 0; step < 2; step++) {
      high = input - low - damping * band;
      band += f * high;
      low += f * band;
    }
    return spec.type === "lowpass" ? low : spec.type === "highpass" ? high : band;
  };
}

/**
 * mulberry32 — a small deterministic generator, so noise is reproducible.
 * @internal Shared with preset generators that need seeded randomness.
 */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(sample: number): number {
  return sample < -1 ? -1 : sample > 1 ? 1 : sample;
}

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw rangeError(name, value, "a finite number greater than 0");
  }
}

function assertAtLeast(name: string, value: number, min: number): void {
  if (!Number.isFinite(value) || value < min) {
    throw rangeError(name, value, `a finite number of at least ${min}`);
  }
}

function rangeError(name: string, value: number, expected: string): Error {
  return new Error(
    `renderSynthPatch: ${name} must be ${expected} (got ${value}).`,
  );
}
