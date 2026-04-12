import type { IMediaInstance } from "@pixi/sound";

/** Wraps an IMediaInstance, tracking playing state via end/stop events. */
export class SoundHandle {
  private _playing = true;
  private readonly _instance: IMediaInstance;

  constructor(instance: IMediaInstance) {
    this._instance = instance;
    instance.once("end", () => {
      this._playing = false;
    });
    instance.once("stop", () => {
      this._playing = false;
    });
  }

  get id(): number {
    return this._instance.id;
  }

  get playing(): boolean {
    return this._playing;
  }

  stop(): void {
    this._instance.stop();
  }

  set volume(v: number) {
    this._instance.volume = v;
  }

  get volume(): number {
    return this._instance.volume;
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
}
