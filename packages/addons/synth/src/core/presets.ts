import { createRandom, DEFAULT_VOLUME } from "./render.js";
import type {
  SynthFilter,
  SynthJingle,
  SynthNote,
  SynthPatch,
  SynthVoice,
} from "./types.js";

/**
 * What a single-voice or layered preset takes. Patch fields land on the
 * voice — the lead voice, when the preset layers several, so the layers keep
 * their relationship — and `gain` scales all of them.
 */
export type SynthPatchOverrides = Partial<SynthPatch> & {
  /**
   * Multiplies every voice's volume, where `volume` sets one voice's peak.
   * Default 1 — the preset's own levels.
   */
  gain?: number;
};

/**
 * What a jingle preset takes. Pitch and timing come from the notes, so a
 * jingle honours its shared voice's fields plus the note lengths; passing
 * `frequency`, `glideTo`, `delay`, or `seamless` is a type error rather than
 * a silently ignored field.
 */
export type SynthJingleOverrides = Partial<SynthVoice> & {
  /**
   * Multiplies the shared voice's volume, which every note is scaled from.
   * Default 1 — the preset's own levels.
   */
  gain?: number;
  /** Seconds each note sounds. */
  noteDuration?: number;
  /** Seconds between note starts. */
  noteSpacing?: number;
};

/** Surfaces `synthPresets.footstep` knows how to sound like. */
export type SynthFootstepSurface = "stone" | "wood" | "grass";

export interface SynthFootstepOptions extends SynthPatchOverrides {
  /** Default `"stone"`. */
  surface?: SynthFootstepSurface;
}

/**
 * What `dialogueBeeps` takes. It generates its own notes, so unlike the other
 * note-sequence presets it has a base `frequency` to wander around — and its
 * own `phraseSeed`, kept distinct from the voice's `seed`.
 */
export interface SynthDialogueBeepsOptions extends SynthJingleOverrides {
  /** Blips in one loop. Default 30. */
  count?: number;
  /** Base pitch the blips wander around, in Hz. Default 330. */
  frequency?: number;
  /**
   * Pitch spread as a ratio: each blip lands between `frequency / spread`
   * and `frequency * spread`. Default 1.15.
   */
  spread?: number;
  /** Picks the blips and rests: one seed always speaks one phrase. Default 1. */
  phraseSeed?: number;
}

/**
 * Per-surface voicing. The filter carries the character and most of the
 * loudness (a wide lowpass passes far more of a noise burst than a narrow
 * band), so each surface carries its own level. Wood keeps its resonance
 * mild — a high `q` bandpass rings metallic. Grass is a soft mid-band
 * rustle: a slow-attack sweep plus a quieter, later scatter for the frayed
 * edge of the step.
 */
const FOOTSTEP_SURFACES: Record<
  SynthFootstepSurface,
  {
    lead: Partial<SynthPatch> & { filter: SynthFilter; volume: number };
    tail?: SynthPatch;
  }
> = {
  stone: {
    lead: {
      filter: { type: "lowpass", frequency: 2600, q: 1.2 },
      volume: 0.29,
    },
  },
  wood: {
    lead: {
      filter: { type: "bandpass", frequency: 520, q: 1.1 },
      duration: 0.06,
      volume: 0.55,
    },
  },
  grass: {
    // A rustle, not a strike. White noise through a lowpass keeps all its
    // bass, and a short low band reads as a thump no matter the attack — so
    // grass is mid-band only, and both voices fade in too slowly to leave a
    // transient.
    lead: {
      filter: { type: "bandpass", frequency: 1200, sweepTo: 750, q: 0.6 },
      duration: 0.14,
      attack: 0.035,
      curve: 1.6,
      volume: 0.56,
    },
    tail: {
      wave: "noise",
      seed: 2,
      delay: 0.04,
      duration: 0.16,
      attack: 0.025,
      curve: 1.3,
      volume: 0.1,
      filter: { type: "bandpass", frequency: 2000, q: 0.9 },
    },
  },
};

/**
 * Ready-made sounds, one per common game cue. Each returns plain patch data
 * and takes overrides, so `synthPresets.shoot({ frequency: 900 })` is a
 * one-number edit away from a different gun.
 *
 * Overrides are typed by what the preset can honour: a one-voice or layered
 * preset takes {@link SynthPatchOverrides} (patch fields, landing on the lead
 * voice when there are several), a note-sequence preset takes
 * {@link SynthJingleOverrides} (its shared voice, `noteDuration`, and
 * `noteSpacing` — pitch comes from the notes). Every preset takes `gain`,
 * which scales all of its voices at once.
 *
 * Levels are tuned so a preset at its default volume sits well against the
 * others; judge them by ear and lower `gain` per game.
 */
export const synthPresets = {
  /** Short pitched blip with a bright noise tick — a pea-shooter or laser. */
  shoot: (overrides?: SynthPatchOverrides) =>
    tweakStack(
      [
        {
          wave: "square",
          frequency: 720,
          glideTo: 190,
          duration: 0.08,
          volume: 0.16,
          curve: 4,
        },
        {
          wave: "noise",
          duration: 0.04,
          volume: 0.07,
          curve: 6,
          filter: { type: "highpass", frequency: 5000 },
        },
      ] satisfies readonly SynthPatch[],
      overrides,
    ),

  /** Blunt impact — a bullet landing, a punch connecting. */
  hit: (overrides?: SynthPatchOverrides) =>
    tweakPatch(
      {
        wave: "triangle",
        frequency: 300,
        glideTo: 90,
        duration: 0.12,
        noise: 0.35,
        volume: 0.28,
        curve: 4,
        filter: { type: "lowpass", frequency: 1800 },
      } satisfies SynthPatch,
      overrides,
    ),

  /** Low boom with a noise body. Raise `duration` and drop the pitch for a bigger one. */
  explosion: (overrides?: SynthPatchOverrides) =>
    tweakPatch(
      {
        wave: "sawtooth",
        frequency: 420,
        glideTo: 60,
        duration: 0.22,
        noise: 0.6,
        volume: 0.42,
        curve: 3,
        filter: { type: "lowpass", frequency: 1400, sweepTo: 400 },
      } satisfies SynthPatch,
      overrides,
    ),

  /** Player damage: two detuned falling tones, the second a beat late. */
  hurt: (overrides?: SynthPatchOverrides) =>
    tweakStack(
      [
        {
          wave: "square",
          frequency: 220,
          glideTo: 70,
          duration: 0.16,
          volume: 0.2,
          curve: 3,
        },
        {
          wave: "sawtooth",
          frequency: 160,
          glideTo: 50,
          duration: 0.16,
          delay: 0.03,
          volume: 0.16,
          curve: 3,
        },
      ] satisfies readonly SynthPatch[],
      overrides,
    ),

  /** Two rising sine notes — health, ammo, anything collected. */
  pickup: (overrides?: SynthJingleOverrides) =>
    tweakJingle(
      {
        notes: [660, 990],
        noteDuration: 0.1,
        noteSpacing: 0.07,
        voice: { wave: "sine", volume: 0.24, curve: 4 },
      } satisfies SynthJingle,
      overrides,
    ),

  /** Brighter, squarer pickup — the arcade coin. */
  coin: (overrides?: SynthJingleOverrides) =>
    tweakJingle(
      {
        notes: [988, 1319],
        noteDuration: 0.09,
        noteSpacing: 0.055,
        voice: { wave: "square", volume: 0.14, curve: 5 },
      } satisfies SynthJingle,
      overrides,
    ),

  /** Rising blip for leaving the ground. */
  jump: (overrides?: SynthPatchOverrides) =>
    tweakPatch(
      {
        wave: "square",
        frequency: 300,
        glideTo: 620,
        duration: 0.12,
        volume: 0.14,
        curve: 3,
      } satisfies SynthPatch,
      overrides,
    ),

  /** Soft thud for touching down. */
  land: (overrides?: SynthPatchOverrides) =>
    tweakPatch(
      {
        wave: "triangle",
        frequency: 180,
        glideTo: 70,
        duration: 0.1,
        noise: 0.35,
        volume: 0.26,
        curve: 5,
        filter: { type: "lowpass", frequency: 900 },
      } satisfies SynthPatch,
      overrides,
    ),

  /** Noise sweeping upward — a dash, dodge roll, or whoosh. */
  dash: (overrides?: SynthPatchOverrides) =>
    tweakPatch(
      {
        wave: "noise",
        duration: 0.22,
        volume: 0.3,
        attack: 0.02,
        curve: 2,
        filter: { type: "bandpass", frequency: 500, sweepTo: 5200, q: 2 },
      } satisfies SynthPatch,
      overrides,
    ),

  /** Long rising tone for picking up a buff. */
  powerup: (overrides?: SynthPatchOverrides) =>
    tweakPatch(
      {
        wave: "square",
        frequency: 400,
        glideTo: 1200,
        duration: 0.3,
        volume: 0.13,
        curve: 2,
      } satisfies SynthPatch,
      overrides,
    ),

  /** One step. The surface picks the filter; everything else is shared. */
  footstep: (options?: SynthFootstepOptions) => {
    const { surface = "stone", ...overrides } = options ?? {};
    const { lead, tail } = FOOTSTEP_SURFACES[surface];
    // The surface table is a module constant, and every other preset builds
    // its data fresh per call — copy the nested filter too, so editing a
    // returned step can't reshape every later one.
    const step = copyPatch({
      wave: "noise",
      duration: 0.07,
      attack: 0.002,
      curve: 6,
      ...lead,
    });
    return tail
      ? tweakStack([step, copyPatch(tail)], overrides)
      : tweakPatch(step, overrides);
  },

  /** Button press. */
  uiClick: (overrides?: SynthPatchOverrides) =>
    tweakPatch(
      {
        wave: "sine",
        frequency: 880,
        glideTo: 660,
        duration: 0.05,
        volume: 0.14,
        curve: 5,
      } satisfies SynthPatch,
      overrides,
    ),

  /** Selection move / text advance — shorter and thinner than `uiClick`. */
  uiBlip: (overrides?: SynthPatchOverrides) =>
    tweakPatch(
      {
        wave: "square",
        frequency: 1200,
        duration: 0.04,
        volume: 0.08,
        curve: 6,
      } satisfies SynthPatch,
      overrides,
    ),

  /** Two-note sting for danger — a detuned dyad under a high blip. */
  alarm: (overrides?: SynthPatchOverrides) =>
    tweakStack(
      [
        {
          wave: "sawtooth",
          frequency: 440,
          duration: 0.45,
          volume: 0.12,
          attack: 0.02,
          curve: 1,
        },
        {
          wave: "sawtooth",
          frequency: 466,
          duration: 0.45,
          volume: 0.12,
          attack: 0.02,
          curve: 1,
        },
        {
          wave: "square",
          frequency: 1245,
          duration: 0.08,
          volume: 0.07,
          curve: 6,
        },
      ] satisfies readonly SynthPatch[],
      overrides,
    ),

  /** Ascending four-note sting — level cleared, quest complete. */
  victory: (overrides?: SynthJingleOverrides) =>
    tweakJingle(
      {
        notes: [523, 659, 784, 1046],
        noteDuration: 0.18,
        noteSpacing: 0.12,
        voice: { wave: "triangle", volume: 0.26, curve: 3 },
      } satisfies SynthJingle,
      overrides,
    ),

  /** Descending four-note sting — death, failure. */
  defeat: (overrides?: SynthJingleOverrides) =>
    tweakJingle(
      {
        notes: [330, 262, 196, 131],
        noteDuration: 0.24,
        noteSpacing: 0.16,
        voice: {
          wave: "sawtooth",
          volume: 0.2,
          curve: 2.5,
          filter: { type: "lowpass", frequency: 2000 },
        },
      } satisfies SynthJingle,
      overrides,
    ),

  /**
   * Low rumbling bed, rendered loop-clean — play it with `loop: true` on a
   * music channel. Three seconds of filtered noise; raise `duration` for a
   * less obvious cycle.
   */
  roomTone: (overrides?: SynthPatchOverrides) =>
    tweakPatch(
      {
        wave: "noise",
        duration: 3,
        volume: 0.6,
        seamless: true,
        filter: { type: "lowpass", frequency: 140, q: 0.8 },
      } satisfies SynthPatch,
      overrides,
    ),

  /**
   * Wind bed, rendered loop-clean — a broad mid-band hiss with two slow gust
   * swells baked into the loop. Play with `loop: true` on an ambience/music
   * channel. Overrides apply to the base bed voice; if you shorten
   * `duration` below ~5.6 s the baked gusts outlive the bed and the loop
   * point stops being clean.
   */
  wind: (overrides?: SynthPatchOverrides) =>
    tweakStack(
      [
        {
          wave: "noise",
          duration: 6,
          volume: 0.32,
          seamless: true,
          filter: { type: "bandpass", frequency: 480, q: 0.55 },
        },
        // Gusts: slow swells that fully decay before the loop point, so the
        // mixed buffer stays loop-clean.
        {
          wave: "noise",
          seed: 2,
          delay: 0.9,
          duration: 1.9,
          attack: 0.75,
          curve: 1.2,
          volume: 0.26,
          filter: { type: "bandpass", frequency: 700, sweepTo: 950, q: 0.8 },
        },
        {
          wave: "noise",
          seed: 3,
          delay: 3.3,
          duration: 2.2,
          attack: 0.9,
          curve: 1.1,
          volume: 0.3,
          filter: { type: "bandpass", frequency: 620, sweepTo: 840, q: 0.8 },
        },
      ] satisfies readonly SynthPatch[],
      overrides,
    ),

  /**
   * Loopable dialogue chatter — short square blips wandering around a base
   * pitch, with syllable-like rests, padded so the loop keeps the blip
   * rhythm. Play with `loop: true` while a line reveals and stop it when the
   * line completes. The same `seed` always speaks the same phrase; give each
   * character its own `frequency` (and `seed`) for a distinct voice.
   */
  dialogueBeeps: (options?: SynthDialogueBeepsOptions) => {
    const {
      count = 30,
      spread = 1.15,
      frequency = 330,
      phraseSeed = 1,
      ...overrides
    } = options ?? {};
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(
        `dialogueBeeps: count must be an integer of at least 1 (got ${count}).`,
      );
    }
    if (!Number.isFinite(spread) || spread <= 0) {
      throw new Error(
        `dialogueBeeps: spread must be a finite number greater than 0 (got ${spread}).`,
      );
    }
    // A pitch of 0 or less would make every blip a rest, so the preset would
    // render silence with nothing to explain it.
    if (!Number.isFinite(frequency) || frequency <= 0) {
      throw new Error(
        `dialogueBeeps: frequency must be a finite number greater than 0 (got ${frequency}).`,
      );
    }
    const random = createRandom(phraseSeed);
    const notes: (number | SynthNote)[] = [];
    for (let i = 0; i < count; i++) {
      // Roughly one blip in six rests, so the chatter phrases like
      // syllables — but never the first, so the loop starts audibly.
      if (i > 0 && random() < 0.16) {
        notes.push(0);
        continue;
      }
      notes.push(frequency * spread ** (random() * 2 - 1));
    }
    // A rest one slot past the last blip pads the buffer to a whole slot, so
    // the wrap pause matches the gap between blips.
    notes.push({ frequency: 0, duration: 0.001 });
    return tweakJingle(
      {
        notes,
        noteDuration: 0.065,
        noteSpacing: 0.065,
        voice: {
          wave: "square",
          volume: 0.14,
          curve: 1,
          filter: { type: "lowpass", frequency: 1900, q: 0.7 },
        },
      } satisfies SynthJingle,
      overrides,
    );
  },
};

/** Merge overrides into a single-voice preset. */
function tweakPatch(
  patch: SynthPatch,
  overrides?: SynthPatchOverrides,
): SynthPatch {
  const { gain, ...fields } = overrides ?? {};
  return applyGain({ ...patch, ...fields }, gain);
}

/**
 * Merge overrides into a layered preset: patch fields shape the lead voice,
 * so the layers keep their relationship, while `gain` scales every voice.
 */
function tweakStack(
  stack: readonly SynthPatch[],
  overrides?: SynthPatchOverrides,
): SynthPatch[] {
  const { gain, ...fields } = overrides ?? {};
  return stack.map((voice, index) =>
    applyGain(index === 0 ? { ...voice, ...fields } : { ...voice }, gain),
  );
}

/** Merge overrides into a jingle preset: note lengths, then the shared voice. */
function tweakJingle(
  jingle: SynthJingle,
  overrides?: SynthJingleOverrides,
): SynthJingle {
  const { gain, noteDuration, noteSpacing, ...voice } = overrides ?? {};
  const merged: SynthJingle = {
    ...jingle,
    voice: applyGain({ ...jingle.voice, ...voice }, gain),
  };
  if (noteDuration !== undefined) merged.noteDuration = noteDuration;
  if (noteSpacing !== undefined) merged.noteSpacing = noteSpacing;
  return merged;
}

function applyGain<T extends { volume?: number }>(
  voice: T,
  gain: number | undefined,
): T {
  if (gain === undefined) return voice;
  // Checked here rather than at render: a negative gain over a zero volume
  // is -0, which the renderer's own volume check reads as valid.
  if (!Number.isFinite(gain) || gain < 0) {
    throw new Error(
      `synthPresets: gain must be a finite number of at least 0 (got ${gain}).`,
    );
  }
  return { ...voice, volume: (voice.volume ?? DEFAULT_VOLUME) * gain };
}

/** Copy a patch deeply enough that a caller editing it can't reach shared data. */
function copyPatch(patch: SynthPatch): SynthPatch {
  return patch.filter
    ? { ...patch, filter: { ...patch.filter } }
    : { ...patch };
}
