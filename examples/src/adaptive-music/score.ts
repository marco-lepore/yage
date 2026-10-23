import type { AssetHandle } from "@yagejs/core";
import { sound, type AudioConfig, type SoundBank } from "@yagejs/audio";
import type { MusicNote, MusicSong } from "@yagejs-addons/music";

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

/** Lead instruments exported in the build-time bank (`audio.config.json`). */
export const LEADS = ["keys", "flute", "clarinet", "organ"] as const;
export type Lead = (typeof LEADS)[number];

/** `hat` is the custom instrument in `instruments.ts`. */
export type BankSound = Lead | "bass" | "kick" | "hat" | "bell" | "wind";

/** The gameplay parameter that brings the rhythm and accent layers in. */
export const INTENSITY = "intensity";

/**
 * The handle of a bank sound. Pitched instruments carry the root note the
 * build tool derived from their frequency, so the music player transposes
 * notes without a `rootNote` in the song.
 */
export function bankSound(
  bank: SoundBank,
  name: BankSound,
): AssetHandle<AudioBuffer> {
  const source = bank.sounds[name];
  if (!source)
    throw new Error(`Music bank: missing "${name}". Run npm run audio:build.`);
  return source;
}

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
export function createSong(
  bank: SoundBank,
  name: SongName,
  lead: Lead,
): MusicSong {
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
        source: bankSound(bank, lead),
        gain: 0.65,
        // Keys decay on their own; the wind instruments hold their sustain
        // loop for the note's duration.
        sustain: lead !== "keys",
        notes: MELODY[name],
      },
      bass: {
        source: bankSound(bank, "bass"),
        gain: 0.55,
        parameter: INTENSITY,
        notes: [
          { beat: 0, note: 48, duration: 2 },
          { beat: 3, note: 45, duration: 2 },
        ],
      },
      kick: {
        source: bankSound(bank, "kick"),
        gain: 0.6,
        parameter: INTENSITY,
        notes: [{ beat: 0 }, { beat: 2 }, { beat: 3 }, { beat: 5 }],
      },
      hat: {
        source: bankSound(bank, "hat"),
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
