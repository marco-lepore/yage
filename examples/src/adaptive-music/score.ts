import { sound, type SoundBank } from "@yagejs/audio";
import type { MusicSong } from "@yagejs-addons/music";
export const RecordedAccent = sound("/assets/laser_gun_shot.wav");
export function createMusicScores(bank: SoundBank): {
  waltz: MusicSong;
  straight: MusicSong;
} {
  for (const name of [
    "keys",
    "bass",
    "kick",
    "bell",
    "wind",
    "flute",
    "clarinet",
    "organ",
  ]) {
    if (!Object.hasOwn(bank.sounds, name))
      throw new Error(`Music bank: missing ${name}.`);
  }
  const waltz: MusicSong = {
    id: "Waltz",
    bpm: 108,
    meter: [3, 4],
    bars: 2,
    gain: 0.7,
    swing: { subdivision: 0.5, amount: 1 / 3 },
    harmony: [
      { beat: 0, chord: [60, 64, 67] },
      { beat: 3, chord: [57, 60, 64] },
    ],
    tracks: {
      keys: {
        source: bank.sounds.keys!,
        gain: 0.65,
        notes: [
          { beat: 0, note: 60, duration: 1 },
          { beat: 0.5, note: 64 },
          { beat: 1, note: 67 },
          { beat: 2, note: 64 },
          { beat: 3, note: 57 },
          { beat: 3.5, note: 60 },
          { beat: 4, note: 64 },
          { beat: 5, note: 60 },
        ],
      },
      bass: {
        source: bank.sounds.bass!,
        rootNote: bank.manifest.sounds.bass!.rootNote!,
        gain: 0.55,
        parameter: "intensity",
        notes: [
          { beat: 0, note: 48, duration: 2 },
          { beat: 3, note: 45, duration: 2 },
        ],
      },
      kick: {
        source: bank.sounds.kick!,
        gain: 0.6,
        parameter: "intensity",
        notes: [{ beat: 0 }, { beat: 2 }, { beat: 3 }, { beat: 5 }],
      },
      recording: {
        source: RecordedAccent,
        gain: 0.12,
        parameter: "intensity",
        parameterRange: [0.6, 1],
        notes: [{ beat: 5.5, duration: 0.2 }],
      },
    },
  };
  const straight: MusicSong = {
    ...waltz,
    id: "Straight four",
    meter: [4, 4],
    bpm: 120,
    swing: { subdivision: 0.5, amount: 0 },
    tracks: {
      ...waltz.tracks,
      keys: {
        source: bank.sounds.keys!,
        gain: 0.6,
        notes: [
          { beat: 0, note: 60 },
          { beat: 1, note: 67 },
          { beat: 2, note: 64 },
          { beat: 3, note: 72 },
          { beat: 4, note: 57 },
          { beat: 5, note: 64 },
          { beat: 6, note: 60 },
          { beat: 7, note: 69 },
        ],
      },
    },
  };

  return { waltz, straight };
}
