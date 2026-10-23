import type { SoundRef } from "@yagejs/audio";
/** One note of a track. */
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
/** One layer of a song: a source played at the track's notes. */
export interface MusicTrack {
  /** Recorded or registered sound the notes play. */
  source: SoundRef;
  /** Notes inside one pattern; the pattern repeats. */
  notes: readonly MusicNote[];
  /**
   * MIDI pitch the source sounds at its original rate. Default: the root note
   * registered with the sound (a synth instrument or a bank entry), else 60.
   */
  rootNote?: number;
  /** Linear gain, 0..1. Default 1. */
  gain?: number;
  /** Stereo position, -1 to 1. Default 0. */
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
/** A chord that holds from `beat` until the next chord. */
export interface MusicHarmony {
  /** Quarter-note position in the repeating pattern. */
  beat: number;
  /** MIDI pitches. Cues can choose the nearest chord tone. */
  chord: readonly number[];
}
/** A repeating pattern of tracks with its tempo, meter and harmony. */
export interface MusicSong {
  /** Name reported by diagnostics. */
  id?: string;
  /** Quarter notes per minute, 20–400. Default 120. */
  bpm?: number;
  /** Numerator and denominator. Default [4, 4]. BPM always counts quarter notes. */
  meter?: readonly [number, number];
  /** Pattern length in bars. Default 1. */
  bars?: number;
  /** Linear gain for the whole song, 0..1. Default 1. */
  gain?: number;
  /** Delay alternate subdivisions by amount * subdivision. 1/3 gives a 2:1 ratio. */
  swing?: { subdivision: number; amount: number };
  /** Track name → track. Names appear in channel names and diagnostics. */
  tracks: Readonly<Record<string, MusicTrack>>;
  /** Chords for harmony-following cues. The first starts at beat 0. */
  harmony?: readonly MusicHarmony[];
}
/** Options for `MusicPlayer` and `MusicComponent`. */
export interface MusicOptions {
  /** Parent channel for the song's channels. Default `music`. */
  channel?: string;
  /** Reproducible uint32 seed. Default 1. */
  seed?: number;
  /** Maximum onset jitter in seconds. Default 0, limited to 0.02. */
  humanize?: number;
  /** Initial 0..1 values of named parameters. */
  parameters?: Readonly<Record<string, number>>;
}
/** Options for `MusicPlayer.play`. */
export interface MusicPlayOptions {
  /** Absolute audio time to start. Default: 30 ms after unlock. */
  at?: number;
  /** Fade-in seconds. Default 0. */
  fade?: number;
}
/** Options for `MusicPlayer.transition`. */
export interface MusicTransitionOptions {
  /** Quarter-note grid for the change, or `"bar"`. Default `"bar"`. */
  grid?: number | "bar";
  /** Crossfade seconds. Default 0.25. */
  fade?: number;
}
/** Options for `MusicPlayer.cue`. */
export interface MusicCueOptions {
  /** Grid in quarter-note beats the cue snaps to. Default 0.5. */
  grid?: number;
  /** MIDI pitch to play. Omit to play the source at its original rate. */
  note?: number;
  /** MIDI pitch of the source. Default: its registered root note, else 60. */
  rootNote?: number;
  /** Linear gain, 0..1. Default 1. */
  volume?: number;
  /** Transpose to the nearest chord tone at the cue time. */
  followHarmony?: boolean;
}
/** Musical position of the playing song. */
export interface MusicPosition {
  /** Quarter-note beats since the song started. */
  beat: number;
  /** Zero-based bar since the song started. */
  bar: number;
  /** Quarter-note beats since the start of the current bar. */
  beatInBar: number;
  /** Quarter-note beats in one bar of the song's meter. */
  beatsPerBar: number;
  /** Fraction of the current beat, 0 to 1. */
  phase: number;
  /** Tempo of the playing song. */
  bpm: number;
}
/** Snapshot returned by `MusicPlayer.getDiagnostics`. */
export interface MusicDiagnostics {
  /** `pending` waits for unlock; `paused` holds the beat. */
  state: "stopped" | "pending" | "playing" | "paused" | "disposed";
  song: string | null;
  position: MusicPosition | null;
  parameters: Readonly<Record<string, number>>;
  /** Notes booked since the player was created. */
  scheduledNotes: number;
  /** Notes skipped because scheduling fell behind. */
  droppedNotes: number;
  /** Calls to `transition` that changed song. */
  transitions: number;
}
