/** Oscillator shape. `"noise"` plays white noise and ignores `frequency`. */
export type SynthWave = "sine" | "square" | "sawtooth" | "triangle" | "noise";

export type SynthFilterType = "lowpass" | "highpass" | "bandpass";

export interface SynthFilter {
  type: SynthFilterType;
  /** Cutoff (centre frequency for `"bandpass"`) in Hz at the start of the sound. */
  frequency: number;
  /** Cutoff at the end of the sound. Omit to hold `frequency`. Swept exponentially. */
  sweepTo?: number;
  /** Resonance. 1 = flat; higher peaks at the cutoff. Default 1. */
  q?: number;
}

/**
 * One voice: an oscillator with a pitch glide, a noise mix, a filter, and an
 * attack + exponential release envelope. Plain data — pass it to
 * {@link renderSynthPatch}, or list several in an array to layer them.
 */
export interface SynthPatch {
  /** Default `"sine"`. */
  wave?: SynthWave;
  /** Starting pitch in Hz. Default 440. */
  frequency?: number;
  /** Pitch at the end of the sound; the glide is exponential. Default: no glide. */
  glideTo?: number;
  /** Length in seconds, excluding `delay`. Default 0.2. */
  duration?: number;
  /** Fade-in in seconds. Default 0.005 — enough to avoid a click. */
  attack?: number;
  /** Release steepness. Default 3; higher is snappier, 0 is a linear fade. */
  curve?: number;
  /** White noise mixed into the tone, 0 to 1. Default 0. */
  noise?: number;
  filter?: SynthFilter;
  /** Peak level before filtering, 0 to 1. Default 0.3. */
  volume?: number;
  /** Silence in seconds before the voice starts, for layering. Default 0. */
  delay?: number;
  /**
   * Seed for the noise generator. Rendering is deterministic: the same patch
   * and sample rate always produce the same samples, and two patches that
   * differ only in `seed` produce different noise. Default 1.
   */
  seed?: number;
  /**
   * Render for looping: no envelope, and the tail is crossfaded into the head
   * so the buffer loops without a click. The result is shorter than
   * `duration` by the crossfade (up to 50 ms). Default false.
   */
  seamless?: boolean;
}

/** A jingle's shared voice. Pitch and length come from the notes. */
export type SynthVoice = Omit<
  SynthPatch,
  "frequency" | "glideTo" | "duration" | "delay" | "seamless"
>;

/** One note of a jingle. A bare number is its frequency in Hz. */
export interface SynthNote {
  /** Hz. 0 is a rest. */
  frequency: number;
  /** Overrides the jingle's `noteDuration` for this note. */
  duration?: number;
  /** Scales the voice volume for this note. Default 1. */
  volume?: number;
}

/** A note sequence rendered into one buffer — victory stings, pickups, alarms. */
export interface SynthJingle {
  notes: readonly (number | SynthNote)[];
  /** How long each note sounds, in seconds. Default 0.16. */
  noteDuration?: number;
  /** Seconds between note starts. Default: `noteDuration` (no overlap). */
  noteSpacing?: number;
  voice?: SynthVoice;
}

/** Anything renderable: one voice, layered voices, or a note sequence. */
export type SynthSound = SynthPatch | readonly SynthPatch[] | SynthJingle;
