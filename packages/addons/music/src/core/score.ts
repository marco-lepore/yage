import type {
  MusicSong,
  MusicTrack,
  MusicNote,
  MusicOptions,
} from "./types.js";
export function finite(
  name: string,
  value: number,
  min = 0,
  max = Number.MAX_VALUE,
): void {
  if (!Number.isFinite(value) || value < min || value > max)
    throw new Error(
      `${name}: must be finite and from ${min} to ${max}, got ${value}.`,
    );
}
export interface CompiledNote {
  beat: number;
  track: string;
  note: MusicNote;
  index: number;
}
export interface CompiledSong {
  song: MusicSong;
  bpm: number;
  beatsPerBar: number;
  beats: number;
  seconds: number;
  notes: readonly CompiledNote[];
}
/** Quarter-note beats per measure, including compound and odd meters. */
export function musicBeatsPerBar(
  meter: readonly [number, number] = [4, 4],
): number {
  return (meter[0] * 4) / meter[1];
}
/** Swing maps continuous beat coordinates, preserving each subdivision pair's length. */
export function musicSwingBeat(
  beat: number,
  swing?: MusicSong["swing"],
): number {
  if (!swing) return beat;
  const pair = swing.subdivision * 2;
  const start = Math.floor(beat / pair) * pair;
  const offset = beat - start;
  return (
    start +
    (offset <= swing.subdivision
      ? offset * (1 + swing.amount)
      : swing.subdivision * (1 + swing.amount) +
        (offset - swing.subdivision) * (1 - swing.amount))
  );
}
export function compileSong(input: MusicSong): CompiledSong {
  const bpm = input.bpm ?? 120;
  finite("MusicSong.bpm", bpm, 20, 400);
  const meter = input.meter ?? [4, 4];
  if (
    !Number.isInteger(meter[0]) ||
    meter[0] < 1 ||
    meter[0] > 32 ||
    ![1, 2, 4, 8, 16, 32].includes(meter[1])
  )
    throw new Error(
      "MusicSong.meter: expected numerator 1..32 and a power-of-two denominator 1..32.",
    );
  const bars = input.bars ?? 1;
  if (!Number.isInteger(bars) || bars < 1 || bars > 1024)
    throw new Error(`MusicSong.bars: expected integer 1..1024, got ${bars}.`);
  finite("MusicSong.gain", input.gain ?? 1, 0, 1);
  const beatsPerBar = musicBeatsPerBar(meter);
  const beats = beatsPerBar * bars;
  if (input.swing) {
    finite(
      "MusicSong.swing.subdivision",
      input.swing.subdivision,
      1 / 128,
      beats / 2,
    );
    finite("MusicSong.swing.amount", input.swing.amount, 0, 0.75);
    const pairs = beats / (2 * input.swing.subdivision);
    if (Math.abs(pairs - Math.round(pairs)) > 1e-8)
      throw new Error(
        "MusicSong.swing: the pattern must contain whole subdivision pairs.",
      );
  }
  const tracks: Record<string, MusicTrack> = {};
  const notes: CompiledNote[] = [];
  for (const [name, track] of Object.entries(input.tracks)) {
    if (!name.trim())
      throw new Error("MusicSong: track names must not be empty.");
    finite(`MusicTrack ${name}.gain`, track.gain ?? 1, 0, 1);
    finite(`MusicTrack ${name}.pan`, track.pan ?? 0, -1, 1);
    finite(`MusicTrack ${name}.rootNote`, track.rootNote ?? 60, 0, 127);
    finite(`MusicTrack ${name}.release`, track.release ?? 0.05, 0.001, 30);
    if (track.parameter !== undefined && !track.parameter.trim())
      throw new Error(`MusicTrack ${name}: parameter name must not be empty.`);
    if (track.parameterRange) {
      const [low, high] = track.parameterRange;
      finite(`MusicTrack ${name}.parameterRange`, low, 0, 1);
      finite(`MusicTrack ${name}.parameterRange`, high, 0, 1);
      if (high <= low || !track.parameter)
        throw new Error(
          `MusicTrack ${name}: parameterRange requires a parameter and low < high.`,
        );
    }
    const copy = track.notes.map((note) => {
      finite(`MusicTrack ${name}.beat`, note.beat, 0, beats);
      if (note.beat >= beats)
        throw new Error(
          `MusicTrack ${name}: beat must be before pattern end ${beats}.`,
        );
      if (note.note !== undefined)
        finite(`MusicTrack ${name}.note`, note.note, 0, 127);
      finite(`MusicTrack ${name}.duration`, note.duration ?? 1, 1 / 128, 1024);
      finite(`MusicTrack ${name}.velocity`, note.velocity ?? 1, 0, 1);
      return { ...note };
    });
    tracks[name] = {
      ...track,
      notes: copy,
      ...(track.parameterRange
        ? { parameterRange: [...track.parameterRange] as [number, number] }
        : {}),
    };
    for (const note of copy)
      notes.push({
        beat: musicSwingBeat(note.beat, input.swing),
        track: name,
        note,
        index: notes.length,
      });
  }
  if (!notes.length)
    throw new Error("MusicSong: at least one note is required.");
  const harmony = input.harmony
    ?.map((point) => {
      finite("MusicSong.harmony.beat", point.beat, 0, beats);
      if (point.beat >= beats || !point.chord.length)
        throw new Error(
          "MusicSong.harmony: chord must be non-empty and before pattern end.",
        );
      for (const note of point.chord)
        finite("MusicSong.harmony.chord", note, 0, 127);
      return { beat: point.beat, chord: [...point.chord] };
    })
    .sort((a, b) => a.beat - b.beat);
  if (harmony?.length && harmony[0]!.beat !== 0)
    throw new Error("MusicSong.harmony: first chord must start at beat 0.");
  const song: MusicSong = {
    ...input,
    meter: [meter[0], meter[1]],
    tracks,
    ...(input.swing ? { swing: { ...input.swing } } : {}),
    ...(harmony ? { harmony } : {}),
  };
  return {
    song,
    bpm,
    beatsPerBar,
    beats,
    seconds: (beats * 60) / bpm,
    notes: notes.sort((a, b) => a.beat - b.beat),
  };
}
export function validateMusicOptions(options: MusicOptions): void {
  const seed = options.seed ?? 1;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error(`MusicOptions.seed: expected uint32, got ${seed}.`);
  finite("MusicOptions.humanize", options.humanize ?? 0, 0, 0.02);
  for (const [name, value] of Object.entries(options.parameters ?? {}))
    finite(`Music parameter ${name}`, value, 0, 1);
}
/** Event-index hashing keeps later notes reproducible even after missed scheduler ticks. */
export function musicJitter(seed: number, index: number): number {
  let value = Math.imul((seed ^ index) >>> 0, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (((value ^ (value >>> 16)) >>> 0) / 0x100000000) * 2 - 1;
}
export function musicLayerGain(
  track: MusicTrack,
  parameters: Readonly<Record<string, number>>,
): number {
  const [low, high] = track.parameterRange ?? [0, 1];
  return (
    (track.gain ?? 1) *
    (track.parameter === undefined
      ? 1
      : Math.max(
          0,
          Math.min(
            1,
            ((parameters[track.parameter] ?? 0) - low) / (high - low),
          ),
        ))
  );
}
