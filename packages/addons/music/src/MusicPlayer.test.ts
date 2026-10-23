import { beforeEach, it, expect, vi } from "vitest";
import type {
  AudioManager,
  AudioPlayOptions,
  SoundHandle,
  SoundRef,
  ChannelConfig,
} from "@yagejs/audio";
import { AudioTimeline } from "@yagejs/audio";
import type { AudioAutomationOptions, SoundMetadata } from "@yagejs/audio";
import { MusicPlayer } from "./MusicPlayer.js";
import { compileSong, musicSwingBeat, musicBeatsPerBar } from "./core/score.js";
import type { MusicSong } from "./core/types.js";
class AudioPort {
  currentTime = 0;
  lookahead = 0.12;
  unlocked = true;
  channels = new Map<string, number>([["music", 0.7]]);
  notes: Array<{
    source: SoundRef;
    options: AudioPlayOptions;
    release: ReturnType<typeof vi.fn>;
  }> = [];
  scheduler: ((now: number, horizon: number) => void) | undefined;
  pauseListener: ((paused: boolean) => void) | undefined;
  timelines = new Map<string, AudioTimeline>();
  onChannelPause(
    _name: string,
    callback: (paused: boolean) => void,
  ): () => void {
    void _name;
    this.pauseListener = callback;
    callback(false);
    return () => {
      this.pauseListener = undefined;
    };
  }
  stopChannel = vi.fn();
  pauseChannel = vi.fn();
  resumeChannel = vi.fn();
  metadata = new Map<SoundRef, SoundMetadata>();
  hasSound(source: SoundRef): boolean {
    return source !== "missing";
  }
  getSoundMetadata(source: SoundRef): SoundMetadata | undefined {
    return this.metadata.get(source);
  }
  isUnlocked(): boolean {
    return this.unlocked;
  }
  addScheduler(cb: (now: number, horizon: number) => void): () => void {
    this.scheduler = cb;
    return () => {
      this.scheduler = undefined;
    };
  }
  createChannel(name: string, options: ChannelConfig): void {
    this.channels.set(name, options.volume ?? 1);
    this.timelines.set(name, new AudioTimeline(options.volume ?? 1));
  }
  setChannelVolume(
    name: string,
    value: number,
    options: AudioAutomationOptions = {},
  ): void {
    this.channels.set(name, value);
    this.timelines
      .get(name)
      ?.set(value, options.at ?? this.currentTime, options.duration ?? 0);
  }
  removeChannel(name: string): void {
    for (const key of this.channels.keys())
      if (key === name || key.startsWith(name + "/")) this.channels.delete(key);
  }
  play(source: SoundRef, options: AudioPlayOptions): SoundHandle {
    const release = vi.fn();
    this.notes.push({ source, options, release });
    return { release, stop: vi.fn() } as unknown as SoundHandle;
  }
  asManager(): AudioManager {
    return this as unknown as AudioManager;
  }
  tick(now: number, horizon = now + this.lookahead): void {
    this.currentTime = now;
    this.scheduler?.(now, horizon);
  }
}
let audio: AudioPort;
const song: MusicSong = {
  id: "waltz",
  bpm: 120,
  meter: [3, 4],
  swing: { subdivision: 0.5, amount: 1 / 3 },
  tracks: {
    keys: {
      source: "keys",
      parameter: "intensity",
      notes: [
        { beat: 0, note: 60 },
        { beat: 0.5, note: 64 },
        { beat: 2, note: 67 },
      ],
    },
  },
  harmony: [
    { beat: 0, chord: [60, 64, 67] },
    { beat: 2, chord: [62, 65, 69] },
  ],
};
beforeEach(() => {
  audio = new AudioPort();
});
it("uses actual three-beat measures and eighth-note swing", () => {
  expect(musicBeatsPerBar([7, 8])).toBe(3.5);
  expect(musicSwingBeat(0.5, song.swing)).toBeCloseTo(2 / 3);
  const p = new MusicPlayer(audio.asManager());
  p.play(song, { at: 0 });
  audio.tick(0, 1.6);
  expect(audio.notes.map((n) => n.options.at)).toEqual([0, 1 / 3, 1, 1.5]);
  expect(p.position(1.5)).toMatchObject({
    bar: 1,
    beatInBar: 0,
    beatsPerBar: 3,
    bpm: 120,
  });
});
it("waits for unlock, lets the latest play request replace pending intent, and cancels it on stop", () => {
  audio.unlocked = false;
  const p = new MusicPlayer(audio.asManager());
  p.play(song);
  p.play({ ...song, id: "new" });
  expect(p.getDiagnostics().state).toBe("pending");
  expect(audio.notes).toHaveLength(0);
  audio.unlocked = true;
  audio.tick(3);
  expect(audio.notes[0]?.options.at).toBe(3.03);
  expect(p.getDiagnostics().song).toBe("new");
  p.stop();
  expect(audio.channels.size).toBe(1);
});
it("maps named parameters to layer gains and rejects unknown names before mutation", () => {
  const p = new MusicPlayer(audio.asManager());
  p.play(song, { at: 0 });
  p.setParameter("intensity", 0.6);
  expect([...audio.channels.values()].at(-1)).toBe(0.6);
  expect(() => p.setParameter("typo", 0.5)).toThrow("typo");
  expect(() => p.setParameter("intensity", NaN)).toThrow();
  audio.currentTime = 0.05;
  expect(p.getDiagnostics().parameters).toEqual({ intensity: 0.6 });
});
it("accepts a configured parameter while stopped", () => {
  const p = new MusicPlayer(audio.asManager(), {
    parameters: { intensity: 0.2 },
  });
  p.setParameter("intensity", 0.9, { duration: 0 });
  expect(p.getDiagnostics().parameters).toEqual({ intensity: 0.9 });
  expect(() => p.setParameter("typo", 0.5)).toThrow("typo");
});
it("reports a cue before the song starts as missing music", () => {
  audio.unlocked = false;
  const p = new MusicPlayer(audio.asManager());
  p.play(song);
  expect(() => p.cue("keys", { note: 64, followHarmony: true })).toThrow(
    "start and unlock music",
  );
});
it("books the opening notes when play starts", () => {
  const p = new MusicPlayer(audio.asManager());
  p.play(song);
  // No scheduler tick has run; the first note is already booked.
  expect(audio.notes.map((n) => n.options.at)).toEqual([0.03]);
  audio.tick(0.05, 0.6);
  expect(audio.notes.map((n) => n.options.at)).toEqual([0.03, 0.03 + 1 / 3]);
  expect(p.getDiagnostics().droppedNotes).toBe(0);
});
it("tunes tracks and cues from the sound's registered root note", () => {
  audio.metadata.set("keys", { rootNote: 48 });
  const p = new MusicPlayer(audio.asManager());
  p.play(song, { at: 0 });
  audio.tick(0, 0.1);
  // Note 60 on a sample pitched at 48 plays an octave up.
  expect(audio.notes[0]?.options.speed).toBeCloseTo(2);
  audio.currentTime = 0.9;
  p.cue("keys", { note: 48 });
  expect(audio.notes.at(-1)?.options.speed).toBeCloseTo(1);
  p.cue("keys", { note: 48, rootNote: 60 });
  expect(audio.notes.at(-1)?.options.speed).toBeCloseTo(0.5);
});
it("keeps an explicit pause when a new song is requested", () => {
  const p = new MusicPlayer(audio.asManager());
  p.play(song, { at: 0 });
  audio.tick(0, 0.1);
  const booked = audio.notes.length;
  p.pause();
  p.play({ ...song, id: "next" });
  audio.tick(0.5, 0.7);
  expect(audio.notes.length).toBe(booked);
  expect(p.getDiagnostics()).toMatchObject({ state: "paused", song: "next" });
  expect(() => p.transition(song)).toThrow("resume");
  p.resume();
  audio.tick(0.6, 0.8);
  expect(audio.notes.length).toBeGreaterThan(booked);
  expect(p.getDiagnostics()).toMatchObject({ state: "playing", song: "next" });
});
it("keeps an explicit start time relative to the request when paused", () => {
  const p = new MusicPlayer(audio.asManager());
  p.play(song, { at: 0 });
  p.pause();
  audio.currentTime = 10;
  p.play({ ...song, id: "next" }, { at: 12 });
  audio.currentTime = 11;
  const booked = audio.notes.length;
  p.resume();
  audio.tick(11, 14);
  // Two seconds after the request, counted in unpaused time: 11 + 2.
  expect(audio.notes.slice(booked)[0]?.options.at).toBe(13);
});
it("quantizes cues and follows the harmony at their future time", () => {
  const p = new MusicPlayer(audio.asManager());
  p.play(song, { at: 0 });
  audio.currentTime = 0.9;
  p.cue("keys", { note: 64, followHarmony: true });
  expect(audio.notes.at(-1)?.options.at).toBe(1.25);
  expect(audio.notes.at(-1)?.options.speed).toBeCloseTo(2 ** (5 / 12));
});
it("transitions at the bar boundary and starts the destination at beat zero", () => {
  const p = new MusicPlayer(audio.asManager());
  p.play(song, { at: 0 });
  audio.currentTime = 0.2;
  expect(p.transition({ ...song, id: "second", bpm: 90 })).toBe(1.5);
  audio.tick(1.5, 1.6);
  expect(audio.notes.at(-1)?.options.at).toBe(1.5);
  expect(p.position()).toMatchObject({ beat: 0, bpm: 90 });
});
it("reproduces humanization and retains event identity after dropped notes", () => {
  const times = (late: boolean): number[] => {
    audio = new AudioPort();
    const p = new MusicPlayer(audio.asManager(), { seed: 42, humanize: 0.005 });
    p.play(song, { at: 0 });
    if (!late) audio.tick(0, 1.4);
    audio.tick(1.4, 3);
    return audio.notes.map((n) => n.options.at!).filter((t) => t >= 1.4);
  };
  expect(times(false)).toEqual(times(true));
});
it("reports missed notes without playing a catch-up burst", () => {
  const p = new MusicPlayer(audio.asManager());
  p.play(song, { at: 0 });
  // play() books the opening note; the late tick skips the 29 notes after it.
  audio.tick(15, 15.1);
  expect(audio.notes.map((n) => n.options.at)).toEqual([0, 15]);
  expect(p.getDiagnostics().droppedNotes).toBe(29);
});
it("pauses at the same beat and cancels booked voices before resuming", () => {
  const p = new MusicPlayer(audio.asManager());
  p.play(song, { at: 0 });
  audio.tick(0, 0.5);
  audio.currentTime = 0.2;
  p.pause();
  audio.tick(5);
  expect(p.position()?.beat).toBeCloseTo(0.4);
  p.resume();
  expect(p.position()?.beat).toBeCloseTo(0.4);
  expect(audio.stopChannel).toHaveBeenCalled();
  audio.tick(5.1, 5.2);
  expect(audio.notes.at(-1)?.options.at).toBeCloseTo(5.133333333);
});
it("releases all channels and the scheduler when disposed", () => {
  const p = new MusicPlayer(audio.asManager());
  p.play(song, { at: 0 });
  p.dispose();
  expect(audio.scheduler).toBeUndefined();
  expect(audio.channels.size).toBe(1);
  expect(() => p.play(song)).toThrow("disposed");
});
it("validates the complete song before replacing playback", () => {
  const p = new MusicPlayer(audio.asManager());
  p.play(song, { at: 0 });
  expect(() =>
    p.play({
      ...song,
      tracks: { bad: { source: "missing", notes: [{ beat: 0 }] } },
    }),
  ).toThrow("missing");
  expect(p.getDiagnostics().song).toBe("waltz");
  for (const bad of [
    { ...song, bpm: NaN },
    { ...song, meter: [0, 4] as const },
    { ...song, swing: { subdivision: 0, amount: 0 } },
    { ...song, gain: Infinity },
  ])
    expect(() => compileSong(bad)).toThrow();
});
it("preserves future parameter ramps across a transition and range thresholds", () => {
  const p = new MusicPlayer(audio.asManager(), {
    parameters: { intensity: 0 },
  });
  p.play(song, { at: 0 });
  p.setParameter("intensity", 1, { at: 10, duration: 2 });
  expect(p.getDiagnostics().parameters.intensity).toBe(0);
  p.transition({
    ...song,
    tracks: { keys: { ...song.tracks.keys!, parameterRange: [0.5, 1] } },
  });
  const layer = [...audio.timelines.values()].at(-1)!;
  expect(layer.valueAt(2)).toBe(0);
  expect(layer.valueAt(11)).toBe(0);
  expect(layer.valueAt(11.5)).toBeCloseTo(0.5);
  expect(layer.valueAt(12)).toBe(1);
});
it("holds the transport when its parent channel pauses, including independent player pause", () => {
  const p = new MusicPlayer(audio.asManager());
  p.play(song, { at: 0 });
  audio.tick(0);
  audio.currentTime = 0.1;
  audio.pauseListener!(true);
  const count = audio.notes.length;
  audio.tick(5);
  expect(audio.notes).toHaveLength(count);
  expect(p.position()!.beat).toBeCloseTo(0.2);
  p.pause();
  audio.pauseListener!(false);
  audio.tick(6);
  expect(audio.notes).toHaveLength(count);
  p.resume();
  expect(p.position()!.beat).toBeCloseTo(0.2);
  audio.tick(6.2, 6.3);
  expect(audio.notes).toHaveLength(count + 1);
});
