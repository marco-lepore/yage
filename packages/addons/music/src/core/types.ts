import type { SoundRef } from "@yagejs/audio";
export interface MusicNote {
  /** Quarter-note beats from the pattern start. Fractional beats are allowed. */
  beat: number;
  /** MIDI pitch. Omit to play a recording at its original rate. */
  note?: number;
  /** Held quarter-note beats. Default 1. */
  duration?: number;
  /** Linear gain, 0..1. Default 1. */
  velocity?: number;
}
export interface MusicTrack {
  source: SoundRef;
  notes: readonly MusicNote[];
  /** MIDI pitch of the sample. Default 60. */
  rootNote?: number;
  gain?: number;
  pan?: number;
  /** Loop the sample's registered sustain region while the note is held. */
  sustain?: boolean;
  /** Seconds to fade out after the held duration. Default 0.05. */
  release?: number;
  /** Named 0..1 gameplay parameter controlling this layer. Defaults to 0. */
  parameter?: string;
  /** Parameter endpoints for silent and full gain. Default [0, 1]. */
  parameterRange?: readonly [number, number];
}
export interface MusicHarmony {
  /** Quarter-note position in the repeating pattern. */
  beat: number;
  /** MIDI pitches. Cues can choose the nearest chord tone. */
  chord: readonly number[];
}
export interface MusicSong {
  id?: string;
  bpm?: number;
  /** Numerator and denominator. Default [4, 4]. BPM always counts quarter notes. */
  meter?: readonly [number, number];
  /** Pattern length in bars. Default 1. */
  bars?: number;
  gain?: number;
  /** Delay alternate subdivisions by amount * subdivision. 1/3 gives a 2:1 ratio. */
  swing?: { subdivision: number; amount: number };
  tracks: Readonly<Record<string, MusicTrack>>;
  harmony?: readonly MusicHarmony[];
}
export interface MusicOptions {
  channel?: string;
  /** Reproducible uint32 seed. Default 1. */
  seed?: number;
  /** Maximum onset jitter in seconds. Default 0, limited to 0.02. */
  humanize?: number;
  parameters?: Readonly<Record<string, number>>;
}
export interface MusicPlayOptions {
  at?: number;
  fade?: number;
}
export interface MusicTransitionOptions {
  grid?: number | "bar";
  fade?: number;
}
export interface MusicCueOptions {
  grid?: number;
  note?: number;
  rootNote?: number;
  volume?: number;
  /** Transpose to the nearest chord tone at the cue time. */
  followHarmony?: boolean;
}
export interface MusicPosition {
  beat: number;
  bar: number;
  beatInBar: number;
  phase: number;
  bpm: number;
}
export interface MusicDiagnostics {
  state: "stopped" | "pending" | "playing" | "paused" | "disposed";
  song: string | null;
  position: MusicPosition | null;
  parameters: Readonly<Record<string, number>>;
  scheduledNotes: number;
  droppedNotes: number;
  transitions: number;
}
