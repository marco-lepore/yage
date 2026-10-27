import { AudioTimeline } from "@yagejs/audio";
import type { AudioManager, SoundHandle, SoundRef } from "@yagejs/audio";
import {
  compileSong,
  finite,
  musicJitter,
  musicLayerGain,
  validateMusicOptions,
  type CompiledSong,
} from "./core/score.js";
import type {
  MusicCueOptions,
  MusicDiagnostics,
  MusicOptions,
  MusicPlayOptions,
  MusicPosition,
  MusicSong,
  MusicTrack,
  MusicTransitionOptions,
} from "./core/types.js";
interface Session {
  score: CompiledSong;
  channel: string;
  layers: Record<string, string>;
  start: number;
  /** The first note not yet booked, counted across repeats. */
  cursor: number;
  /** Notes after `cursor` already booked: humanize can move a note ahead of an earlier one. */
  booked: Set<number>;
  end: number;
  removeAt: number;
}
let playerId = 0;
/** Entity-owned musical transport. Every node and timer belongs to AudioManager. */
export class MusicPlayer {
  private readonly namespace = `music-player-${++playerId}`;
  private sessionId = 0;
  private readonly sessions: Session[] = [];
  private readonly unsubscribe: () => void;
  private readonly parameters = new Map<string, AudioTimeline>();
  private readonly unsubscribePause: () => void;
  private ownPaused = false;
  private channelPaused = false;
  private pending:
    | { score: CompiledSong; options: MusicPlayOptions }
    | undefined;
  private pauseTime: number | undefined;
  private disposed = false;
  private scheduled = 0;
  private dropped = 0;
  private transitionCount = 0;
  constructor(
    private readonly audio: AudioManager,
    private readonly options: MusicOptions = {},
  ) {
    validateMusicOptions(options);
    this.options = { ...options };
    for (const [name, value] of Object.entries(options.parameters ?? {}))
      this.parameters.set(name, new AudioTimeline(value));
    this.unsubscribePause = audio.onChannelPause(
      options.channel ?? "music",
      (paused) => {
        this.channelPaused = paused;
        this.reconcilePause();
      },
    );
    this.unsubscribe = audio.addScheduler((now, horizon) =>
      this.tick(now, horizon),
    );
  }
  /**
   * Replace playback with `song` from beat zero. Without `at` it starts 30 ms
   * after audio unlocks; an explicit `at` is an absolute audio time. While the
   * player or its channel is paused, the song waits for resume. Throws for a
   * missing source or invalid song data before changing playback.
   */
  play(song: MusicSong, options: MusicPlayOptions = {}): void {
    this.assertActive();
    const score = this.prepare(song);
    if (options.at !== undefined)
      finite("MusicPlayer.play.at", options.at, this.audio.currentTime);
    finite("MusicPlayer.play.fade", options.fade ?? 0, 0, 30);
    this.stop();
    const pending = { ...options };
    // Resume shifts a pending start by the whole pause, so count `at` from
    // the paused position, as setParameter does.
    if (pending.at !== undefined)
      pending.at -= this.audio.currentTime - this.controlTime;
    this.pending = { score, options: pending };
    this.reconcilePause();
    if (
      this.pauseTime === undefined &&
      (this.audio.isUnlocked() || options.at !== undefined)
    ) {
      const now = this.audio.currentTime;
      this.startPending(now);
      // Book the first window now. A main-thread stall right after this call,
      // such as a scene's first render, would otherwise skip the opening notes.
      this.tick(now, now + this.audio.lookahead);
    }
  }
  /**
   * Start `song` at beat zero on the next bar (or `grid` beats) beyond the
   * lookahead, crossfading over `fade` seconds (default 0.25). Returns the
   * audio time of the change. With no song playing it starts `song` like
   * `play()`, without a fade, and returns the current audio time. Throws
   * while paused.
   */
  transition(song: MusicSong, options: MusicTransitionOptions = {}): number {
    this.assertActive();
    if (this.pauseTime !== undefined)
      throw new Error(
        "MusicPlayer.transition: resume music before transitioning.",
      );
    const score = this.prepare(song);
    const current =
      this.current(this.audio.currentTime) ?? this.sessions.at(-1);
    if (!current) {
      this.play(song);
      return this.audio.currentTime;
    }
    const grid =
      options.grid === "bar" || options.grid === undefined
        ? current.score.beatsPerBar
        : options.grid;
    finite("MusicPlayer.transition.grid", grid, 1 / 128, 1024);
    finite("MusicPlayer.transition.fade", options.fade ?? 0.25, 0, 30);
    const at = this.quantize(
      grid,
      this.audio.currentTime + this.audio.lookahead,
    );
    const fade = options.fade ?? 0.25;
    for (const session of this.sessions) {
      session.end = Math.min(session.end, at);
      session.removeAt = at + fade;
      this.audio.setChannelVolume(session.channel, 0, { at, duration: fade });
      this.audio.stopChannel(session.channel, at + fade);
    }
    this.begin(score, at, fade);
    this.transitionCount++;
    return at;
  }
  /**
   * Set a named 0–1 parameter, ramping over `duration` seconds (default 0.05).
   * Layers mapped to it, including notes already booked, follow the ramp.
   * Throws for a name no song or option declares.
   */
  setParameter(
    name: string,
    value: number,
    options: { at?: number; duration?: number } = {},
  ): void {
    this.assertActive();
    finite(`MusicPlayer.setParameter ${name}`, value, 0, 1);
    const now = this.audio.currentTime;
    const at = options.at ?? now;
    const duration = options.duration ?? 0.05;
    finite("MusicPlayer.setParameter.at", at, now);
    finite("MusicPlayer.setParameter.duration", duration, 0, 30);
    const known =
      this.parameters.has(name) ||
      this.sessions.some((s) =>
        Object.values(s.score.song.tracks).some((t) => t.parameter === name),
      ) ||
      Object.values(this.pending?.score.song.tracks ?? {}).some(
        (t) => t.parameter === name,
      );
    if (!known)
      throw new Error(`MusicPlayer.setParameter: unknown parameter "${name}".`);
    const effectiveAt = at - (this.audio.currentTime - this.controlTime);
    const timeline = this.parameters.get(name) ?? new AudioTimeline(0);
    timeline.set(value, effectiveAt, duration);
    timeline.prune(this.controlTime);
    this.parameters.set(name, timeline);
    for (const session of this.sessions)
      for (const [id, track] of Object.entries(session.score.song.tracks))
        if (track.parameter === name)
          this.applyParameter(session.layers[id]!, track);
  }
  private get controlTime(): number {
    return this.pauseTime ?? this.audio.currentTime;
  }
  private parameterValues(): Record<string, number> {
    return Object.fromEntries(
      [...this.parameters].map(([name, timeline]) => [
        name,
        timeline.valueAt(this.controlTime),
      ]),
    );
  }
  private applyParameter(channel: string, track: MusicTrack): void {
    if (track.parameter === undefined) return;
    const timeline = this.parameters.get(track.parameter);
    if (!timeline) return;
    const points = timeline.events(this.controlTime);
    const delta = this.audio.currentTime - this.controlTime;
    const gain = (value: number): number =>
      musicLayerGain(track, { [track.parameter!]: value });
    const first = points[0]!;
    this.audio.setChannelVolume(channel, gain(first.value), {
      at: Math.max(this.audio.currentTime, first.at + delta),
    });
    for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1]!;
      const point = points[i]!;
      if (point.curve === "step") {
        this.audio.setChannelVolume(channel, gain(point.value), {
          at: Math.max(this.audio.currentTime, point.at + delta),
        });
        continue;
      }
      const [low, high] = track.parameterRange ?? [0, 1];
      const crossings = [low, high]
        .filter(
          (value) =>
            value > Math.min(previous.value, point.value) &&
            value < Math.max(previous.value, point.value),
        )
        .map((value) => ({
          value,
          at:
            previous.at +
            ((point.at - previous.at) * (value - previous.value)) /
              (point.value - previous.value),
        }));
      crossings.push(point);
      crossings.sort((a, b) => a.at - b.at);
      let from = previous.at;
      for (const end of crossings) {
        this.audio.setChannelVolume(channel, gain(end.value), {
          at: Math.max(this.audio.currentTime, from + delta),
          duration: end.at - from,
        });
        from = end.at;
      }
    }
  }
  /** Schedule a source at the next musical grid line. */
  cue(source: SoundRef, options: MusicCueOptions = {}): SoundHandle {
    this.assertActive();
    if (this.pauseTime !== undefined)
      throw new Error("MusicPlayer.cue: resume music before scheduling a cue.");
    if (!this.audio.hasSound(source))
      throw new Error(
        `MusicPlayer.cue: missing sound "${typeof source === "string" ? source : source.path}".`,
      );
    finite("MusicPlayer.cue.grid", options.grid ?? 0.5, 1 / 128, 1024);
    finite("MusicPlayer.cue.volume", options.volume ?? 1, 0, 1);
    finite("MusicPlayer.cue.rootNote", options.rootNote ?? 60, 0, 127);
    if (options.note !== undefined)
      finite("MusicPlayer.cue.note", options.note, 0, 127);
    const at = this.quantize(
      options.grid ?? 0.5,
      this.audio.currentTime + this.audio.lookahead,
    );
    const owner = this.current(at) ?? this.sessions.at(-1);
    if (!owner)
      throw new Error(
        "MusicPlayer.cue: start and unlock music before scheduling a cue.",
      );
    let note = options.note;
    if (options.followHarmony) {
      if (note === undefined)
        throw new Error("MusicPlayer.cue: followHarmony requires note.");
      const chord = this.harmonyAt(at);
      if (!chord.length)
        throw new Error(
          "MusicPlayer.cue: no authored harmony at the cue time.",
        );
      let best = note;
      let distance = Infinity;
      for (const tone of chord) {
        const candidate = tone + 12 * Math.round((note - tone) / 12);
        const d = Math.abs(candidate - note);
        if (d < distance) {
          best = candidate;
          distance = d;
        }
      }
      note = best;
    }
    return this.audio.play(source, {
      channel: owner.channel,
      at,
      volume: options.volume ?? 1,
      speed:
        note === undefined
          ? 1
          : 2 ** ((note - this.rootNoteOf(source, options.rootNote)) / 12),
    });
  }
  /** The first grid line, `grid` quarter-note beats apart, at or after `time`. */
  quantize(grid = 1, time = this.audio.currentTime): number {
    const session = this.current(time) ?? this.sessions[0];
    if (!session) return time;
    const step = (grid * 60) / session.score.bpm;
    return (
      session.start +
      Math.max(0, Math.ceil((time - session.start) / step - 1e-9)) * step
    );
  }
  /** Musical position at `time`, or null before a song starts. Frozen while paused. */
  position(time = this.audio.currentTime): MusicPosition | null {
    const t = this.pauseTime ?? time;
    const session = this.current(t);
    if (!session) return null;
    const beat = Math.max(0, ((t - session.start) * session.score.bpm) / 60);
    return {
      beat,
      bar: Math.floor(beat / session.score.beatsPerBar),
      beatInBar: beat % session.score.beatsPerBar,
      beatsPerBar: session.score.beatsPerBar,
      phase: beat % 1,
      bpm: session.score.bpm,
    };
  }
  /** The authored chord at `time`, as MIDI pitches. Empty without harmony. */
  harmonyAt(time = this.audio.currentTime): readonly number[] {
    const session = this.current(time) ?? this.sessions[0];
    if (!session) return [];
    const beat =
      Math.max(0, ((time - session.start) * session.score.bpm) / 60) %
      session.score.beats;
    return [
      ...(session.score.song.harmony
        ?.filter((h) => h.beat <= beat + 1e-8)
        .at(-1)?.chord ?? []),
    ];
  }
  /** Stop the sounding and booked notes and hold the beat until `resume()`. */
  pause(): void {
    this.ownPaused = true;
    this.reconcilePause();
  }
  /** Continue from the held beat with the next note. A channel pause still holds. */
  resume(): void {
    this.ownPaused = false;
    this.reconcilePause();
  }
  private reconcilePause(): void {
    const paused = this.ownPaused || this.channelPaused;
    if (paused && this.pauseTime === undefined) {
      this.pauseTime = this.audio.currentTime;
      for (const session of this.sessions) {
        this.audio.stopChannel(session.channel);
        this.audio.pauseChannel(session.channel);
      }
    } else if (!paused && this.pauseTime !== undefined) {
      const delta = this.audio.currentTime - this.pauseTime;
      for (const timeline of this.parameters.values())
        timeline.shift(this.pauseTime, delta);
      if (this.pending?.options.at !== undefined)
        this.pending.options.at += delta;
      for (const session of this.sessions) {
        session.start += delta;
        session.end += delta;
        session.removeAt += delta;
        session.cursor = this.cursorAt(session, this.audio.currentTime);
        session.booked.clear();
        this.audio.resumeChannel(session.channel);
      }
      this.pauseTime = undefined;
    }
  }
  /**
   * Stop every note and forget the song, including one waiting for unlock.
   * An explicit `pause()` stays in force: a later `play()` waits for `resume()`.
   */
  stop(): void {
    for (const session of this.sessions)
      this.audio.removeChannel(session.channel);
    this.sessions.length = 0;
    this.pending = undefined;
  }
  /** Stop playback and release the scheduler and pause subscriptions. */
  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.unsubscribe();
    this.unsubscribePause();
    this.disposed = true;
  }
  /** State, song id, position, parameters and note counters for inspection. */
  getDiagnostics(): MusicDiagnostics {
    return {
      state: this.disposed
        ? "disposed"
        : this.pauseTime !== undefined
          ? "paused"
          : this.pending
            ? "pending"
            : this.sessions.length
              ? "playing"
              : "stopped",
      song:
        (this.current(this.audio.currentTime) ?? this.sessions[0])?.score.song
          .id ??
        this.pending?.score.song.id ??
        null,
      position: this.position(),
      parameters: this.parameterValues(),
      scheduledNotes: this.scheduled,
      droppedNotes: this.dropped,
      transitions: this.transitionCount,
    };
  }
  private assertActive(): void {
    if (this.disposed) throw new Error("MusicPlayer: player is disposed.");
  }
  private prepare(song: MusicSong): CompiledSong {
    const score = compileSong(song);
    const tracks: Record<string, MusicTrack> = {};
    for (const [name, track] of Object.entries(score.song.tracks)) {
      if (!this.audio.hasSound(track.source))
        throw new Error(
          `MusicTrack ${name}: missing sound "${typeof track.source === "string" ? track.source : track.source.path}".`,
        );
      tracks[name] = {
        ...track,
        rootNote: this.rootNoteOf(track.source, track.rootNote),
      };
    }
    return { ...score, song: { ...score.song, tracks } };
  }
  /** The authored root note, else the sound's registered one, else middle C. */
  private rootNoteOf(source: SoundRef, authored: number | undefined): number {
    return authored ?? this.audio.getSoundMetadata(source)?.rootNote ?? 60;
  }
  private begin(score: CompiledSong, start: number, fade: number): void {
    const parent = this.options.channel ?? "music";
    const channel = `${this.namespace}-${++this.sessionId}`;
    this.audio.createChannel(channel, {
      parent,
      volume: fade > 0 ? 0 : (score.song.gain ?? 1),
    });
    if (fade > 0)
      this.audio.setChannelVolume(channel, score.song.gain ?? 1, {
        at: start,
        duration: fade,
      });
    const layers: Record<string, string> = {};
    for (const [name, track] of Object.entries(score.song.tracks)) {
      const layer = `${channel}/${name}`;
      layers[name] = layer;
      this.audio.createChannel(layer, {
        parent: channel,
        volume: musicLayerGain(track, this.parameterValues()),
      });
      this.applyParameter(layer, track);
    }
    this.sessions.push({
      score,
      channel,
      layers,
      start,
      cursor: 0,
      booked: new Set(),
      end: Infinity,
      removeAt: Infinity,
    });
  }
  private startPending(now: number): void {
    if (!this.pending) return;
    const { score, options } = this.pending;
    this.begin(score, options.at ?? now + 0.03, options.fade ?? 0);
    this.pending = undefined;
  }
  private current(time: number): Session | undefined {
    return this.sessions
      .filter((s) => s.start <= time + 1e-9 && time < s.end)
      .at(-1);
  }
  private cursorAt(s: Session, time: number): number {
    const cycle = Math.max(0, Math.floor((time - s.start) / s.score.seconds));
    const beat =
      ((time - s.start - cycle * s.score.seconds) * s.score.bpm) / 60;
    const index = s.score.notes.findIndex((n) => n.beat >= beat - 1e-9);
    return (
      cycle * s.score.notes.length + (index < 0 ? s.score.notes.length : index)
    );
  }
  private tick(now: number, horizon: number): void {
    if (this.pauseTime !== undefined) return;
    this.startPending(now);
    for (const session of [...this.sessions]) {
      if (now >= session.removeAt) {
        this.audio.removeChannel(session.channel);
        this.sessions.splice(this.sessions.indexOf(session), 1);
        continue;
      }
      const score = session.score;
      const jitter = this.options.humanize ?? 0;
      // Notes the session should have booked by now are missed. Notes after
      // its end belong to a transition, which cancelled them.
      const skip = this.cursorAt(session, Math.min(now - jitter, session.end));
      if (skip > session.cursor) {
        let missed = skip - session.cursor;
        for (const index of session.booked)
          if (index < skip) {
            session.booked.delete(index);
            missed--;
          }
        this.dropped += missed;
        session.cursor = skip;
      }
      // Humanize moves each note by up to `jitter`, so a note can start
      // before the one listed ahead of it. Every note whose earliest start
      // falls before the horizon is checked, not only the notes up to the
      // first one a later tick owns.
      const limit = Math.min(horizon, session.end);
      let guard = 0;
      for (let index = session.cursor; ; index++) {
        if (++guard > 100000)
          throw new Error(
            "MusicPlayer: scheduling horizon exceeds 100000 notes.",
          );
        const entry = score.notes[index % score.notes.length]!;
        const cycle = Math.floor(index / score.notes.length);
        const nominal =
          session.start + cycle * score.seconds + (entry.beat * 60) / score.bpm;
        if (nominal - jitter >= limit) break;
        if (session.booked.has(index)) continue;
        const at = Math.max(
          session.start,
          nominal +
            musicJitter(
              this.options.seed ?? 1,
              cycle * score.notes.length + entry.index,
            ) *
              jitter,
        );
        // A later tick owns this note.
        if (at >= horizon) continue;
        session.booked.add(index);
        if (at < now - 1e-6) {
          this.dropped++;
          continue;
        }
        if (at >= session.end) continue;
        const track = score.song.tracks[entry.track]!;
        const note = entry.note;
        const handle = this.audio.play(track.source, {
          channel: session.layers[entry.track]!,
          at,
          volume: note.velocity ?? 1,
          pan: track.pan ?? 0,
          speed:
            note.note === undefined
              ? 1
              : 2 ** ((note.note - track.rootNote!) / 12),
          loop: track.sustain ?? false,
        });
        const releaseAt = at + ((note.duration ?? 1) * 60) / score.bpm;
        handle.release({ at: releaseAt, duration: track.release ?? 0.05 });
        if (session.removeAt !== Infinity)
          handle.stop(
            Math.min(session.removeAt, releaseAt + (track.release ?? 0.05)),
          );
        this.scheduled++;
      }
      while (session.booked.delete(session.cursor)) session.cursor++;
    }
  }
}
