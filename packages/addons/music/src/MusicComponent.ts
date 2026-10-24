import { Component } from "@yagejs/core";
import { AudioManagerKey } from "@yagejs/audio";
import { MusicPlayer } from "./MusicPlayer.js";
import type { MusicOptions, MusicSong } from "./core/types.js";
/** Owns music for an entity. Scene pause leaves the audio clock running; disable/destroy stops it. */
export class MusicComponent extends Component {
  private transport: MusicPlayer | undefined;
  constructor(
    private readonly song: MusicSong,
    private readonly options: MusicOptions = {},
  ) {
    super();
  }
  /** The player for this entity's music. Throws before the component is added. */
  get player(): MusicPlayer {
    if (!this.transport)
      throw new Error("MusicComponent: component is not attached.");
    return this.transport;
  }
  onAdd(): void {
    this.transport = new MusicPlayer(this.use(AudioManagerKey), this.options);
  }
  onEnable(): void {
    this.player.play(this.song);
  }
  onDisable(): void {
    this.player.stop();
  }
  onDestroy(): void {
    // Absent when onAdd threw; the entity still destroys the component.
    this.transport?.dispose();
    this.transport = undefined;
  }
}
