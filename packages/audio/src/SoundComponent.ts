import { Component } from "@yagejs/core";
import type { SoundHandle } from "./SoundHandle.js";
import { AudioManagerKey, type SoundComponentOptions } from "./types.js";

/** Entity-bound audio component that delegates playback to AudioManager. */
export class SoundComponent extends Component {
  private readonly _alias: string;
  private readonly _channel: string;
  private readonly _loop: boolean;
  private readonly _volume: number;
  private readonly _playOnAdd: boolean;

  private _handle: SoundHandle | null = null;
  private _autoplayPending = false;

  constructor(options: SoundComponentOptions) {
    super();
    this._alias = options.alias;
    this._channel = options.channel ?? "sfx";
    this._loop = options.loop ?? false;
    this._volume = options.volume ?? 1;
    this._playOnAdd = options.playOnAdd ?? false;
  }

  onAdd(): void {
    // A component is never effectively enabled during `onAdd`. Defer the
    // autoplay to `onEnable` so a sound added to a dormant entity stays quiet
    // until the entity is active. It stays one-shot: later reactivations do
    // not replay it.
    if (this._playOnAdd) {
      this._autoplayPending = true;
    }
  }

  onEnable(): void {
    if (!this._autoplayPending) return;
    this._autoplayPending = false;
    this.play();
  }

  play(): SoundHandle {
    if (this._handle?.playing) {
      this._handle.stop();
    }

    const manager = this.use(AudioManagerKey);
    this._handle = manager.play(this._alias, {
      channel: this._channel,
      loop: this._loop,
      volume: this._volume,
    });
    return this._handle;
  }

  stop(): void {
    if (this._handle?.playing) {
      this._handle.stop();
    }
    this._handle = null;
  }

  get handle(): SoundHandle | null {
    return this._handle;
  }

  /** The registered asset alias this component plays. */
  get alias(): string {
    return this._alias;
  }

  /** The mixer channel playback is routed to. */
  get channel(): string {
    return this._channel;
  }

  /** Whether playback repeats. */
  get loop(): boolean {
    return this._loop;
  }

  /** Playback volume (0–1), before channel and master gain. */
  get volume(): number {
    return this._volume;
  }

  /**
   * Stop playback. A dormant entity goes quiet; it does not resume on its
   * own when reactivated, so call `play()` again if the sound should restart.
   */
  onDisable(): void {
    this.stop();
  }

  onDestroy(): void {
    this.stop();
  }
}
