import { Component, Entity } from "@yagejs/core";
import {
  AudioManagerKey,
  measureAudio,
  renderAudio,
  type AudioMeasurements,
  type SoundBank,
  type SoundHandle,
} from "@yagejs/audio";
import {
  MusicComponent,
  MusicPlayer,
  type MusicSong,
} from "@yagejs-addons/music";
import {
  AMBIENCE,
  AUDIO_MIX,
  INTENSITY,
  LEADS,
  bankSound,
  createSong,
  type Lead,
  type SongName,
} from "./score.js";

/** Wind loop level, speed and pan for an intensity from 0 to 1. */
function windAt(intensity: number): {
  volume: number;
  speed: number;
  pan: number;
} {
  return {
    volume: 0.05 + intensity * 0.15,
    speed: 0.5 + intensity,
    pan: intensity * 2 - 1,
  };
}

// ---------------------------------------------------------------------------
// MusicDirector — the rules that turn game state into music
// ---------------------------------------------------------------------------

/**
 * Reacts to game intents: danger raises the intensity layers, a reward plays
 * a cue in the current chord, a new area changes song on the next bar, and
 * pausing the game holds the music and the wind on their beat.
 */
export class MusicDirector extends Component {
  private readonly audio = this.service(AudioManagerKey);
  private music!: MusicComponent;
  private wind: SoundHandle | undefined;
  private _lead: Lead = "keys";
  private _song: SongName = "waltz";
  private _intensity: number;
  private _paused = false;
  private _offlineMix: AudioMeasurements | null = null;
  private _measuring = false;

  constructor(
    private readonly bank: SoundBank,
    intensity: number,
  ) {
    super();
    this._intensity = intensity;
  }

  get lead(): Lead {
    return this._lead;
  }
  get song(): SongName {
    return this._song;
  }
  get intensity(): number {
    return this._intensity;
  }
  get paused(): boolean {
    return this._paused;
  }
  /** Measurements of the last offline render, or null before the first. */
  get offlineMix(): AudioMeasurements | null {
    return this._offlineMix;
  }
  get measuring(): boolean {
    return this._measuring;
  }
  get player(): MusicPlayer {
    return this.music.player;
  }

  onAdd(): void {
    this.music = this.entity.get(MusicComponent);
    // Booked on the audio clock, so the loop starts once audio unlocks.
    this.wind = this.audio.play(bankSound(this.bank, "wind"), {
      channel: AMBIENCE,
      loop: true,
      ...windAt(this._intensity),
    });
  }

  onDestroy(): void {
    this.wind?.stop();
  }

  /** Bring the bass, kick, hi-hat and accent layers in as danger rises. */
  setIntensity(value: number): void {
    this._intensity = value;
    this.player.setParameter(INTENSITY, value, { duration: 0.2 });
    const wind = windAt(value);
    this.wind?.setVolume(wind.volume, { duration: 0.2 });
    this.wind?.setSpeed(wind.speed, { duration: 0.2 });
    this.wind?.setPan(wind.pan, { duration: 0.2 });
  }

  /** Swap the melody instrument on the next bar. */
  setLead(lead: Lead): void {
    this.player.transition(createSong(this.bank, this._song, lead));
    this._lead = lead;
  }

  /** Move between the waltz and the straight song on the next bar. */
  changeSong(): void {
    const song = this._song === "waltz" ? "straight" : "waltz";
    this.player.transition(createSong(this.bank, song, this._lead));
    this._song = song;
  }

  /** A reward sting on the next eighth note, moved into the current chord. */
  playReward(): void {
    // Before the first gesture unlocks audio there is no song to join.
    if (this.player.getDiagnostics().state !== "playing") return;
    this.player.cue(bankSound(this.bank, "bell"), {
      grid: 0.5,
      note: 74,
      followHarmony: true,
    });
  }

  /**
   * Pause or resume the game. Music runs on the audio clock, so pausing the
   * scene alone would leave it playing. Pausing its channels holds the beat
   * and the remaining fades until resume. A paused player rejects cues and
   * transitions, so the page disables those controls meanwhile.
   */
  togglePause(): void {
    this._paused = !this._paused;
    this.scene.paused = this._paused;
    for (const channel of ["music", AMBIENCE]) {
      if (this._paused) this.audio.pauseChannel(channel);
      else this.audio.resumeChannel(channel);
    }
  }

  /**
   * Render five seconds of the current song offline, with a scripted
   * intensity rise, and measure the result. The same seed and plan give the
   * same mix on every run.
   */
  async measureOfflineMix(): Promise<void> {
    this._measuring = true;
    // A failed render still ends the measurement, so the HUD stops waiting;
    // the rejection reaches the caller.
    try {
      const song = this.currentSong();
      const wind = bankSound(this.bank, "wind");
      const buffer = await renderAudio(
        { duration: 5, mix: AUDIO_MIX },
        (audio) => {
          const player = new MusicPlayer(audio, {
            seed: 17,
            parameters: { [INTENSITY]: 0.4 },
          });
          player.play(song, { at: 0.1 });
          player.setParameter(INTENSITY, 1, { at: 2, duration: 0.4 });
          audio
            .play(wind, { channel: AMBIENCE, at: 0, loop: true, volume: 0.08 })
            .setSpeed(1.3, { at: 2, duration: 1 });
          audio.updateSchedule(0, 5);
        },
      );
      this._offlineMix = measureAudio(
        Array.from({ length: buffer.numberOfChannels }, (_, i) =>
          buffer.getChannelData(i),
        ),
        buffer.sampleRate,
      );
    } finally {
      this._measuring = false;
    }
  }

  private currentSong(): MusicSong {
    return createSong(this.bank, this._song, this._lead);
  }
}

// ---------------------------------------------------------------------------
// MusicControls — page controls standing in for gameplay events
// ---------------------------------------------------------------------------

/** Connects the page's controls to the director's game intents. */
class MusicControls extends Component {
  private readonly director: MusicDirector;

  constructor(director: MusicDirector) {
    super();
    this.director = director;
  }

  onAdd(): void {
    this.onClick("reward", () => this.director.playReward());
    this.onClick("song", () => this.director.changeSong());
    this.onClick("measure", () => void this.director.measureOfflineMix());
    this.onClick("remove", () => this.entity.destroy());
    const lead = this.element<HTMLSelectElement>("lead");
    const musical = [
      lead,
      this.element<HTMLButtonElement>("reward"),
      this.element<HTMLButtonElement>("song"),
    ];
    const pause = this.element<HTMLButtonElement>("pause");
    this.onClick("pause", () => {
      this.director.togglePause();
      const paused = this.director.paused;
      pause.textContent = paused ? "Resume game" : "Pause game";
      for (const control of musical) control.disabled = paused;
    });

    this.onEvent(lead, "change", () => {
      const choice = LEADS.find((name) => name === lead.value);
      if (!choice)
        throw new Error(`Adaptive music: unknown lead ${lead.value}.`);
      this.director.setLead(choice);
    });
    const danger = this.element<HTMLInputElement>("danger");
    this.onEvent(danger, "input", () =>
      this.director.setIntensity(Number(danger.value)),
    );
  }

  private element<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Adaptive music: missing #${id}.`);
    return element as T;
  }

  private onClick(id: string, handler: () => void): void {
    this.onEvent(this.element(id), "click", handler);
  }

  private onEvent(
    element: HTMLElement,
    type: string,
    handler: () => void,
  ): void {
    element.addEventListener(type, handler);
    this.addCleanup(() => element.removeEventListener(type, handler));
  }
}

// ---------------------------------------------------------------------------
// MusicProbe — state the e2e test reads through the inspector
// ---------------------------------------------------------------------------

/** Read-only view of the music host for `inspector.getComponentData`. */
class MusicProbe extends Component {
  private readonly audio = this.service(AudioManagerKey);

  constructor(
    private readonly director: MusicDirector,
    private readonly bank: SoundBank,
  ) {
    super();
  }

  get music() {
    return this.director.player.getDiagnostics();
  }
  get mixer() {
    return this.audio.getDiagnostics();
  }
  get bankSize() {
    const entries = Object.values(this.bank.manifest.sounds);
    return {
      sounds: entries.length,
      files: new Set(entries.map((entry) => entry.file)).size,
    };
  }
  get paused(): boolean {
    return this.director.paused;
  }
  get offlineMix(): AudioMeasurements | null {
    return this.director.offlineMix;
  }
  get measuring(): boolean {
    return this.director.measuring;
  }
}

// ---------------------------------------------------------------------------
// MusicHostEntity — owns the song, the wind bed and the music state
// ---------------------------------------------------------------------------

/** Spawn key of the music host, for `scene.findByKey`. */
export const MUSIC_KEY = "music";

/**
 * Hosts the music for the scene. Destroying this entity stops its song and
 * its wind loop.
 */
export class MusicHostEntity extends Entity {
  director!: MusicDirector;

  setup(bank: SoundBank): void {
    const intensity = 0.25;
    this.add(
      new MusicComponent(createSong(bank, "waltz", "keys"), {
        seed: 17,
        parameters: { [INTENSITY]: intensity },
      }),
    );
    this.director = this.add(new MusicDirector(bank, intensity));
    this.add(new MusicControls(this.director));
    this.add(new MusicProbe(this.director, bank));
  }
}
