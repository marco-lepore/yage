import { sound, type AudioConfig } from "@yagejs/audio";
import type { MusicNote, MusicSong } from "@yagejs-addons/music";
import {
  bass,
  brownNoise,
  clarinet,
  electricPiano,
  flute,
  glassBell,
  kick,
  organ,
} from "@yagejs-addons/synth/instruments";
import { hat } from "./instruments.js";

// ---------------------------------------------------------------------------
// Mix and sources
// ---------------------------------------------------------------------------

/** Channel for the wind bed. It pauses with the game, like the music. */
export const AMBIENCE = "ambience";

/** Live mix levels. The offline render uses the same levels. */
export const AUDIO_MIX: AudioConfig = {
  channels: { [AMBIENCE]: { volume: 0.8 } },
};

/** A recorded file layered into both songs as a high-intensity accent. */
export const RecordedAccent = sound("/assets/laser_gun_shot.wav");

/**
 * Instruments `SynthPlugin` renders when the game starts. `hat` is the
 * example's own instrument, defined in `instruments.ts`.
 */
export const INSTRUMENTS = {
  electricPiano,
  bass,
  kick,
  hat,
  glassBell,
  brownNoise,
  flute,
  clarinet,
  organ,
};

/**
 * The sounds the songs and the director play, by alias. `SynthPlugin`
 * registers each one with its sustain loop and root note, so the music player
 * transposes notes without a `rootNote` in the song. Bass and flute render at
 * C3 and C5; the other pitched instruments at middle C.
 */
export const SOUNDS = {
  keys: electricPiano.sound(),
  bass: bass.sound({ frequency: 130.812783 }),
  kick: kick.sound(),
  hat: hat.sound(),
  bell: glassBell.sound(),
  wind: brownNoise.sound(),
  flute: flute.sound({ frequency: 523.251131 }),
  clarinet: clarinet.sound(),
  organ: organ.sound(),
};
export type SoundName = keyof typeof SOUNDS;

/** The sounds that can play the melody. */
export const LEADS = [
  "keys",
  "flute",
  "clarinet",
  "organ",
] as const satisfies readonly SoundName[];
export type Lead = (typeof LEADS)[number];

/** The gameplay parameter that brings the rhythm and accent layers in. */
export const INTENSITY = "intensity";

// ---------------------------------------------------------------------------
// Songs
// ---------------------------------------------------------------------------

export type SongName = "waltz" | "straight";

const MELODY: Record<SongName, MusicNote[]> = {
  waltz: [
    { beat: 0, note: 60 },
    { beat: 0.5, note: 64 },
    { beat: 1, note: 67 },
    { beat: 2, note: 64 },
    { beat: 3, note: 57 },
    { beat: 3.5, note: 60 },
    { beat: 4, note: 64 },
    { beat: 5, note: 60 },
  ],
  straight: [
    { beat: 0, note: 60 },
    { beat: 1, note: 67 },
    { beat: 2, note: 64 },
    { beat: 3, note: 72 },
    { beat: 4, note: 57 },
    { beat: 5, note: 64 },
    { beat: 6, note: 60 },
    { beat: 7, note: 69 },
  ],
};

/**
 * Two bars of a swung 3/4 waltz or a straight 4/4 pattern, with `lead` on the
 * melody. Bass, kick, hi-hat and the recorded accent follow the intensity
 * parameter.
 */
export function createSong(name: SongName, lead: Lead): MusicSong {
  const waltz = name === "waltz";
  return {
    id: waltz ? "Waltz" : "Straight four",
    bpm: waltz ? 108 : 120,
    meter: waltz ? [3, 4] : [4, 4],
    bars: 2,
    gain: 0.7,
    ...(waltz ? { swing: { subdivision: 0.5, amount: 1 / 3 } } : {}),
    harmony: [
      { beat: 0, chord: [60, 64, 67] },
      { beat: 3, chord: [57, 60, 64] },
    ],
    tracks: {
      lead: {
        source: lead,
        gain: 0.65,
        // Keys decay on their own; the wind instruments hold their sustain
        // loop for the note's duration.
        sustain: lead !== "keys",
        notes: MELODY[name],
      },
      bass: {
        source: "bass" satisfies SoundName,
        gain: 0.55,
        parameter: INTENSITY,
        notes: [
          { beat: 0, note: 48, duration: 2 },
          { beat: 3, note: 45, duration: 2 },
        ],
      },
      kick: {
        source: "kick" satisfies SoundName,
        gain: 0.6,
        parameter: INTENSITY,
        notes: [{ beat: 0 }, { beat: 2 }, { beat: 3 }, { beat: 5 }],
      },
      hat: {
        source: "hat" satisfies SoundName,
        gain: 0.25,
        parameter: INTENSITY,
        // Every off-beat of both bars; the waltz's swing delays them.
        notes: Array.from({ length: waltz ? 6 : 8 }, (_, i) => ({
          beat: i + 0.5,
        })),
      },
      accent: {
        source: RecordedAccent,
        gain: 0.12,
        parameter: INTENSITY,
        // Silent until intensity passes 0.6.
        parameterRange: [0.6, 1],
        notes: [{ beat: 5.5, duration: 0.2 }],
      },
    },
  };
}
