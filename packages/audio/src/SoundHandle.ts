import type {
  AudioAutomationOptions,
  AudioFadeOptions,
  AudioPlayOptions,
  SoundReleaseOptions,
} from "./types.js";
import { AudioTimeline } from "./AudioTimeline.js";
import { automationTiming } from "./internal/Automation.js";
import {
  assertFadeDuration,
  assertPan,
  assertSpeed,
  assertTime,
  assertVolume,
} from "./internal/validation.js";

/** One voice, including its booked start and paused source position. */
export class SoundHandle {
  private source: AudioBufferSourceNode | undefined;
  private readonly gain: GainNode;
  private readonly panner: StereoPannerNode;
  private readonly muteGain: GainNode;
  private readonly level: AudioTimeline;
  private readonly rate: AudioTimeline;
  private readonly stereo: AudioTimeline;
  private active = true;
  private ownPaused = false;
  private channelPaused = false;
  private pauseAt: number | undefined;
  private isMuted = false;
  private startAt: number;
  private offset: number;
  private stopAt: number | undefined;
  /** True while `stopAt` is the end of a `stopOnComplete` fade. */
  private fadeOwnsStop = false;
  /** The stop that fade replaced, restored when a volume write replaces the fade. */
  private stopBeforeFade: number | undefined;
  private readonly listeners: Array<(natural: boolean) => void> = [];

  /** @internal Voices are constructed by AudioManager.play(). */
  constructor(
    readonly id: number,
    readonly channel: string,
    readonly alias: string,
    private readonly context: BaseAudioContext,
    private readonly buffer: AudioBuffer,
    private readonly options: AudioPlayOptions,
    output: AudioNode,
  ) {
    this.startAt = Math.max(
      context.currentTime,
      options.at ?? context.currentTime,
    );
    this.offset = options.offset ?? 0;
    this.stopAt = options.stopAt;
    this.level = new AudioTimeline(options.volume ?? 1);
    this.rate = new AudioTimeline(options.speed ?? 1);
    this.stereo = new AudioTimeline(options.pan ?? 0);
    this.gain = context.createGain();
    this.panner = context.createStereoPanner();
    this.muteGain = context.createGain();
    this.gain.connect(this.panner);
    this.panner.connect(this.muteGain);
    this.muteGain.connect(output);
    this.startSource();
  }
  /** True until the sound ends or stops, including while booked or paused. */
  get playing(): boolean {
    return this.active;
  }
  /** True while the sound's booked start is still in the future. */
  get scheduled(): boolean {
    return this.active && this.startAt > this.context.currentTime;
  }
  /**
   * Per-sound volume 0–1, before channel and master volume. Writing it steps
   * to the value now and replaces any fade.
   */
  get volume(): number {
    return this.level.valueAt(this.controlTime);
  }
  set volume(value: number) {
    this.setVolume(value);
  }
  /** Playback rate; 2 plays an octave up and twice as fast. */
  get speed(): number {
    return this.rate.valueAt(this.controlTime);
  }
  set speed(value: number) {
    this.setSpeed(value);
  }
  /** Stereo position from -1 (left) to 1 (right). */
  get pan(): number {
    return this.stereo.valueAt(this.controlTime);
  }
  set pan(value: number) {
    this.setPan(value);
  }
  /** Silence this sound without changing its volume. */
  get muted(): boolean {
    return this.isMuted;
  }
  set muted(value: boolean) {
    this.isMuted = value;
    this.muteGain.gain.setValueAtTime(value ? 0 : 1, this.context.currentTime);
  }
  /**
   * True while this sound or its channel is paused. Writing pauses or resumes
   * the sound itself; the position and remaining automation are kept.
   */
  get paused(): boolean {
    return this.pauseAt !== undefined;
  }
  set paused(value: boolean) {
    this.ownPaused = value;
    this.reconcilePause();
  }
  private get controlTime(): number {
    return this.pauseAt ?? this.context.currentTime;
  }

  /**
   * Set the volume at `options.at` (default now), ramping over `options.duration`.
   * Replaces the automation from that time onward.
   */
  setVolume(value: number, options?: AudioAutomationOptions): void {
    assertVolume("SoundHandle.setVolume", value);
    this.automate(this.level, this.gain.gain, value, options);
  }
  /** Set the playback rate, with the same timing options as `setVolume`. */
  setSpeed(value: number, options?: AudioAutomationOptions): void {
    assertSpeed("SoundHandle.setSpeed", value);
    this.automate(this.rate, this.source?.playbackRate, value, options);
  }
  /** Set the stereo position, with the same timing options as `setVolume`. */
  setPan(value: number, options?: AudioAutomationOptions): void {
    assertPan("SoundHandle.setPan", value);
    this.automate(this.stereo, this.panner.pan, value, options);
  }
  /**
   * Ramp the volume to `value` over `options.duration` seconds on the audio
   * clock. With `stopOnComplete` (target 0 only) the sound stops at the end,
   * unless a later volume write that starts before the end replaces the fade.
   */
  fadeTo(value: number, options: AudioFadeOptions): void {
    assertVolume("SoundHandle.fadeTo", value);
    assertFadeDuration("SoundHandle.fadeTo", options.duration);
    if (!this.active)
      throw new Error("SoundHandle.fadeTo: sound is not playing.");
    if (options.stopOnComplete && value !== 0)
      throw new Error("SoundHandle.fadeTo: stopOnComplete requires volume 0.");
    const timing = automationTiming(
      "SoundHandle.fadeTo",
      this.context.currentTime,
      options,
    );
    this.setVolume(value, options);
    if (!options.stopOnComplete) return;
    const before = this.stopAt;
    this.stop(timing.at + timing.duration);
    if (!this.active) return;
    this.fadeOwnsStop = true;
    this.stopBeforeFade = before;
  }
  /**
   * Fade to silence over `duration` seconds (default 0.05) starting at `at`
   * (default now), then stop. A zero duration stops at `at`.
   */
  release(options: SoundReleaseOptions = {}): void {
    const at = options.at ?? this.context.currentTime;
    const duration = options.duration ?? 0.05;
    assertTime("SoundHandle.release.duration", duration);
    if (duration === 0) {
      automationTiming("SoundHandle.release", this.context.currentTime, { at });
      this.stop(at);
    } else this.fadeTo(0, { at, duration, stopOnComplete: true });
  }
  /**
   * Stop at audio time `at`, or now. Stopping now also cancels a booked start
   * that has not arrived.
   */
  stop(at?: number): void {
    if (at !== undefined) assertTime("SoundHandle.stop.at", at);
    if (!this.active) return;
    this.fadeOwnsStop = false;
    const time =
      at === undefined
        ? this.controlTime
        : at - (this.context.currentTime - this.controlTime);
    if (time <= this.controlTime) {
      this.detachSource();
      this.finish(false);
    } else {
      this.stopAt = time;
      this.source?.stop(time);
    }
  }
  /** @internal */
  _onFinish(callback: (natural: boolean) => void): void {
    this.listeners.push(callback);
  }
  /** @internal */
  _setChannelPaused(paused: boolean): void {
    this.channelPaused = paused;
    this.reconcilePause();
  }

  private automate(
    timeline: AudioTimeline,
    param: AudioParam | undefined,
    value: number,
    options?: AudioAutomationOptions,
  ): void {
    const { at, duration, curve } = automationTiming(
      "SoundHandle automation",
      this.context.currentTime,
      options,
    );
    if (!this.active)
      throw new Error("SoundHandle automation: sound is not playing.");
    const effectiveAt = at - (this.context.currentTime - this.controlTime);
    timeline.set(value, effectiveAt, duration, curve);
    if (timeline === this.rate && !this.paused) {
      this.capturePosition(this.controlTime);
      this.startAt = Math.max(this.startAt, this.controlTime);
    }
    timeline.prune(this.controlTime);
    if (param && !this.paused) timeline.apply(param, this.context.currentTime);
    if (
      timeline === this.level &&
      this.fadeOwnsStop &&
      effectiveAt < this.stopAt!
    )
      this.cancelFadeStop();
  }
  /** The fade that booked `stopAt` was replaced, so its stop goes too. */
  private cancelFadeStop(): void {
    this.fadeOwnsStop = false;
    this.stopAt = this.stopBeforeFade;
    this.stopBeforeFade = undefined;
    if (this.stopAt !== undefined && this.stopAt <= this.controlTime) {
      this.detachSource();
      this.finish(false);
      return;
    }
    if (this.paused) return;
    // A source's booked stop cannot be withdrawn: continue on a new source.
    const now = this.context.currentTime;
    this.capturePosition(now);
    this.startAt = Math.max(this.startAt, now);
    this.detachSource();
    this.startSource();
  }
  private startSource(): void {
    const source = this.context.createBufferSource();
    this.source = source;
    source.buffer = this.buffer;
    source.loop = this.options.loop ?? false;
    source.loopStart = this.options.loopStart ?? 0;
    source.loopEnd = this.options.loopEnd ?? this.buffer.duration;
    this.rate.apply(source.playbackRate, this.context.currentTime);
    this.level.apply(this.gain.gain, this.context.currentTime);
    this.stereo.apply(this.panner.pan, this.context.currentTime);
    source.connect(this.gain);
    source.onended = () => {
      if (this.source !== source) return;
      source.disconnect();
      this.source = undefined;
      this.finish(
        this.stopAt === undefined ||
          (!this.options.loop &&
            this.offset +
              this.rate.integral(
                this.startAt,
                Math.max(this.startAt, this.stopAt),
              ) >=
              this.buffer.duration - 1 / this.context.sampleRate),
      );
    };
    source.start(this.startAt, this.offset);
    if (this.stopAt !== undefined) source.stop(this.stopAt);
  }
  private detachSource(): void {
    const source = this.source;
    this.source = undefined;
    if (source) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
  }
  private capturePosition(now: number): void {
    const until = Math.min(now, this.stopAt ?? now);
    if (until > this.startAt)
      this.offset += this.rate.integral(this.startAt, until);
    if (this.options.loop) {
      const begin = this.options.loopStart ?? 0;
      const end = this.options.loopEnd ?? this.buffer.duration;
      if (this.offset >= end)
        this.offset = begin + ((this.offset - begin) % (end - begin));
    }
  }
  private reconcilePause(): void {
    if (!this.active) return;
    const paused = this.ownPaused || this.channelPaused;
    const now = this.context.currentTime;
    if (paused && this.pauseAt === undefined) {
      this.capturePosition(now);
      this.pauseAt = now;
      this.detachSource();
    } else if (!paused && this.pauseAt !== undefined) {
      const previous = this.pauseAt;
      const delta = now - previous;
      this.startAt = Math.max(now, this.startAt + delta);
      if (this.stopAt !== undefined) this.stopAt += delta;
      if (this.stopBeforeFade !== undefined) this.stopBeforeFade += delta;
      this.level.shift(previous, delta);
      this.rate.shift(previous, delta);
      this.stereo.shift(previous, delta);
      this.pauseAt = undefined;
      if (!this.options.loop && this.offset >= this.buffer.duration)
        this.finish(true);
      else this.startSource();
    }
  }
  private finish(natural: boolean): void {
    if (!this.active) return;
    this.active = false;
    this.gain.disconnect();
    this.panner.disconnect();
    this.muteGain.disconnect();
    for (const callback of this.listeners) callback(natural);
    this.listeners.length = 0;
  }
}
