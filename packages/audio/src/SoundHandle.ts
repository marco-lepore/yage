import type { IMediaInstance } from "@pixi/sound";
import { easeLinear, Process } from "@yagejs/core";
import type { ScopedProcessQueue } from "@yagejs/core";
import type { AudioFadeOptions } from "./types.js";
import { assertFadeDuration, assertVolume } from "./internal/validation.js";

/** Wraps an IMediaInstance, tracking playing state via end/stop events. */
export class SoundHandle {
  private _playing = true;
  private readonly _instance: IMediaInstance;
  private _channel = "sfx";
  private _volume: number;
  private _applyVolume: (volume: number) => void;
  private _fadeQueue: ScopedProcessQueue | undefined;
  private _fade: Process | undefined;

  constructor(instance: IMediaInstance) {
    this._instance = instance;
    this._volume = instance.volume;
    this._applyVolume = (volume) => (instance.volume = volume);
    instance.once("end", () => {
      this._finishPlayback();
    });
    instance.once("stop", () => {
      this._finishPlayback();
    });
  }

  get id(): number {
    return this._instance.id;
  }

  get playing(): boolean {
    return this._playing;
  }

  /** Mixer channel this sound plays through. */
  get channel(): string {
    return this._channel;
  }

  stop(): void {
    this._instance.stop();
  }

  set volume(v: number) {
    assertVolume("SoundHandle.volume", v);
    this._volume = v;
    this._applyVolume(v);
  }

  get volume(): number {
    return this._volume;
  }

  /**
   * Fade the pre-channel volume on the engine-global frame clock. Starting a
   * new fade cancels this handle's current fade.
   */
  fadeTo(volume: number, options: AudioFadeOptions): Process {
    const duration = options.duration;
    const easing = options.easing ?? easeLinear;
    const stopOnComplete = options.stopOnComplete ?? false;

    assertVolume("SoundHandle.fadeTo", volume);
    assertFadeDuration("SoundHandle.fadeTo", duration);
    if (!this._playing) {
      throw new Error("SoundHandle.fadeTo: sound is not playing.");
    }
    if (stopOnComplete && volume !== 0) {
      throw new Error(
        "SoundHandle.fadeTo: stopOnComplete requires a target volume of 0.",
      );
    }
    if (!this._fadeQueue) {
      throw new Error(
        "SoundHandle.fadeTo: this handle was not created by an installed AudioManager.",
      );
    }

    const from = this._volume;
    const fade = new Process({
      duration,
      update: (_dt, elapsed) => {
        const progress = Math.min(1, elapsed / duration);
        const eased = easing(progress);
        if (!Number.isFinite(eased)) {
          throw new Error(
            `SoundHandle.fadeTo: easing must return a finite number, got ${eased}.`,
          );
        }
        const bounded = Math.min(1, Math.max(0, eased));
        this.volume = from + (volume - from) * bounded;
      },
      onComplete: () => {
        this.volume = volume;
        if (this._fade === fade) this._fade = undefined;
        if (stopOnComplete) this.stop();
      },
      onCancel: () => {
        if (this._fade === fade) this._fade = undefined;
      },
    });

    this._fade?.cancel();
    this._fade = fade;
    return this._fadeQueue.run(fade);
  }

  set speed(v: number) {
    this._instance.speed = v;
  }

  get speed(): number {
    return this._instance.speed;
  }

  set muted(v: boolean) {
    this._instance.muted = v;
  }

  get muted(): boolean {
    return this._instance.muted;
  }

  set paused(v: boolean) {
    this._instance.paused = v;
  }

  get paused(): boolean {
    return this._instance.paused;
  }

  /** Reapply the logical volume after the channel volume changes. @internal */
  _refreshVolume(): void {
    this._applyVolume(this._volume);
  }

  /** Connect this handle to its manager's channel and fade queue. @internal */
  _setMixer(
    channel: string,
    volume: number,
    applyVolume: (volume: number) => void,
    fadeQueue: ScopedProcessQueue | undefined,
  ): void {
    this._channel = channel;
    this._volume = volume;
    this._applyVolume = applyVolume;
    this._fadeQueue = fadeQueue;
  }

  private _finishPlayback(): void {
    this._playing = false;
    this._fade?.cancel();
    this._fade = undefined;
  }
}
