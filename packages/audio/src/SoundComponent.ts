import { Component, serializable } from "@yagejs/core";
import type { SoundHandle } from "./SoundHandle.js";
import { AudioManagerKey, type SoundComponentOptions, type SoundData } from "./types.js";

/** Entity-bound audio component that delegates playback to AudioManager. */
@serializable
export class SoundComponent extends Component {
  private readonly _alias: string;
  private readonly _channel: string;
  private readonly _loop: boolean;
  private readonly _volume: number;
  private readonly _playOnAdd: boolean;

  private _handle: SoundHandle | null = null;

  constructor(options: SoundComponentOptions) {
    super();
    this._alias = options.alias;
    this._channel = options.channel ?? "sfx";
    this._loop = options.loop ?? false;
    this._volume = options.volume ?? 1;
    this._playOnAdd = options.playOnAdd ?? false;
  }

  onAdd(): void {
    if (this._playOnAdd) {
      this.play();
    }
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

  serialize(): SoundData {
    return {
      alias: this._alias,
      channel: this._channel,
      loop: this._loop,
      volume: this._volume,
      playOnAdd: this._playOnAdd,
    };
  }

  static fromSnapshot(data: SoundData): SoundComponent {
    return new SoundComponent(data);
  }

  onDestroy(): void {
    this.stop();
  }
}
