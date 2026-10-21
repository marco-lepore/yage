import {
  Component,
  Engine,
  Entity,
  InspectorPlugin,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import { RendererPlugin, TextComponent } from "@yagejs/renderer";
import {
  AudioPlugin,
  AudioManagerKey,
  measureAudio,
  renderAudio,
  type SoundHandle,
  type AudioMeasurements,
  soundBank,
  type SoundBank,
} from "@yagejs/audio";
import {
  MusicComponent,
  MusicPlayer,
  type MusicSong,
} from "@yagejs-addons/music";
import { setupGameContainer } from "../shared/bootstrap.js";
import { RecordedAccent, createMusicScores } from "./score.js";

class MusicLab extends Component {
  private music!: MusicComponent;
  private loop: SoundHandle | undefined;
  private alternate = false;
  intensity = 0.25;
  offline: AudioMeasurements | null = null;
  measuring = false;
  failure: string | null = null;
  constructor(
    private readonly text: TextComponent,
    private readonly bank: SoundBank,
    private readonly scores: { waltz: MusicSong; straight: MusicSong },
  ) {
    super();
  }
  private lead = "keys";
  get loading() {
    const entries = Object.values(this.bank.manifest.sounds);
    return {
      mode: "files",
      aliases: entries.length,
      files: new Set(entries.map((e) => e.file)).size,
    };
  }
  private get song(): MusicSong {
    const score = this.alternate ? this.scores.straight : this.scores.waltz;
    return {
      ...score,
      tracks: {
        ...score.tracks,
        keys: {
          ...score.tracks.keys!,
          source: this.bank.sounds[this.lead]!,
          rootNote: this.bank.manifest.sounds[this.lead]!.rootNote!,
          sustain: this.lead !== "keys",
        },
      },
    };
  }
  get diagnostics() {
    return this.music.player.getDiagnostics();
  }
  get audio() {
    return this.use(AudioManagerKey).getDiagnostics();
  }
  onAdd(): void {
    this.music = this.entity.get(MusicComponent);
    const lead = document.querySelector<HTMLSelectElement>("#lead")!;
    const changeLead = (): void =>
      this.use(AudioManagerKey).invoke("Music lead", () => {
        if (!["keys", "flute", "clarinet", "organ"].includes(lead.value))
          throw new Error(`Unknown lead instrument ${lead.value}.`);
        this.lead = lead.value;
        this.music.player.transition(this.song);
      });
    lead.addEventListener("change", changeLead);
    this.addCleanup(() => lead.removeEventListener("change", changeLead));
    this.bind("start", () => {
      this.music.player.resume();
    });
    this.bind("cue", () => {
      this.music.player.cue(this.bank.sounds.bell!, {
        note: 74,
        followHarmony: true,
      });
    });
    this.bind("transition", () => {
      this.alternate = !this.alternate;
      this.music.player.transition(this.song);
    });
    this.bind("pause", () => {
      if (this.music.player.getDiagnostics().state === "paused")
        this.music.player.resume();
      else this.music.player.pause();
    });
    this.bind("channel-pause", () => {
      const audio = this.use(AudioManagerKey);
      if (
        audio.getDiagnostics().channels.find((c) => c.name === "music")?.paused
      )
        audio.resumeChannel("music");
      else audio.pauseChannel("music");
    });
    this.bind("scene-pause", () => {
      this.scene.paused = !this.scene.paused;
    });
    this.bind("recording", () => {
      this.use(AudioManagerKey).play(RecordedAccent, { volume: 0.2 });
    });
    this.bind("loop", () => {
      if (this.loop?.playing) {
        this.loop.stop();
        this.loop = undefined;
      } else
        this.loop = this.use(AudioManagerKey).play(this.bank.sounds.wind!, {
          loop: true,
          volume: 0.1,
          speed: 0.7,
          pan: -0.3,
        });
    });
    this.bind("measure", () => this.measure());
    this.bind("remove-owner", () => this.entity.destroy());
    const input = document.querySelector<HTMLInputElement>("#intensity")!;
    const change = (): void =>
      this.use(AudioManagerKey).invoke("Music lab intensity", () => {
        this.intensity = Number(input.value);
        this.music.player.setParameter("intensity", this.intensity);
        if (this.loop?.playing) {
          this.loop.setVolume(0.05 + this.intensity * 0.15, { duration: 0.1 });
          this.loop.setSpeed(0.5 + this.intensity, { duration: 0.1 });
          this.loop.setPan(this.intensity * 2 - 1, { duration: 0.1 });
        }
      });
    input.addEventListener("input", change);
    this.addCleanup(() => input.removeEventListener("input", change));
  }
  private bind(id: string, callback: () => void | Promise<void>): void {
    const button = document.getElementById(id)!;
    const listener = (): void => {
      this.use(AudioManagerKey).invoke(`Music lab ${id}`, callback);
    };
    button.addEventListener("click", listener);
    this.addCleanup(() => button.removeEventListener("click", listener));
  }
  async measure(): Promise<void> {
    this.measuring = true;
    this.failure = null;
    try {
      const buffer = await renderAudio({ duration: 5 }, (audio) => {
        const player = new MusicPlayer(audio, {
          seed: 17,
          parameters: { intensity: 0.7 },
        });
        player.play(this.song, { at: 0.1 });
        player.setParameter("intensity", 1, { at: 2, duration: 0.4 });
        audio
          .play(this.bank.sounds.wind!, {
            at: 0,
            loop: true,
            volume: 0.08,
            stopAt: 5,
          })
          .setSpeed(1.3, { at: 2, duration: 1 });
        audio.updateSchedule(0, 5);
      });
      this.offline = measureAudio(
        Array.from({ length: buffer.numberOfChannels }, (_, i) =>
          buffer.getChannelData(i),
        ),
        buffer.sampleRate,
      );
    } catch (error) {
      this.measuring = false;
      this.failure = error instanceof Error ? error.message : String(error);
      throw error;
    }
    this.measuring = false;
  }
  update(): void {
    const d = this.diagnostics;
    const a = this.audio;
    const beat = d.position?.beatInBar ?? 0;
    this.text.setText(
      [
        "ADAPTIVE MUSIC",
        `${d.song ?? "Ready"} · ${a.state} · ${d.position?.bpm ?? 108} BPM`,
        `Beat ${(beat + 1).toFixed(2)} · intensity ${this.intensity.toFixed(2)}`,
        `Voices ${a.activeVoices} · booked notes ${d.scheduledNotes} · missed ${d.droppedNotes}`,
        `Bank ${this.loading.aliases} sounds · ${this.loading.files} files · lead ${this.lead}`,
        this.offline
          ? `Offline peak ${this.offline.samplePeak.toFixed(3)} · RMS ${this.offline.rms.toFixed(3)} · clipped ${this.offline.clippedSamples}`
          : this.measuring
            ? "Rendering five seconds…"
            : "Render five seconds to inspect the mix.",
        "Scene pause leaves music playing. Music pause holds its beat.",
      ].join("\n"),
    );
  }
  onDisable(): void {
    this.loop?.stop();
  }
  onDestroy(): void {
    this.loop?.stop();
  }
}
class MusicLabEntity extends Entity {
  setup(bank: SoundBank): void {
    const scores = createMusicScores(bank);
    this.add(new Transform({ position: new Vec2(32, 35) }));
    const text = this.add(
      new TextComponent({
        text: "Preparing audio…",
        style: {
          fontFamily: "monospace",
          fontSize: 18,
          fill: 0xcbd5f5,
          lineHeight: 34,
        },
      }),
    );
    this.add(
      new MusicComponent(scores.waltz, {
        seed: 17,
        parameters: { intensity: 0.25 },
      }),
    );
    this.add(new MusicLab(text, bank, scores));
  }
}
class MusicLabScene extends Scene {
  readonly name = "adaptive-music";
  readonly preload;
  constructor(private readonly bank: SoundBank) {
    super();
    this.preload = [RecordedAccent, ...Object.values(bank.sounds)];
  }
  onEnter(): void {
    this.spawn(MusicLabEntity, this.bank);
  }
}
async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(
    new RendererPlugin({
      width: 800,
      height: 350,
      container: setupGameContainer(800, 350),
      backgroundColor: 0x111827,
    }),
  );
  engine.use(new InspectorPlugin());
  engine.use(new AudioPlugin());
  const base = `${import.meta.env.BASE_URL}generated/audio/`;
  const response = await fetch(`${base}manifest.json`);
  if (!response.ok)
    throw new Error(
      `Music bank: HTTP ${response.status}. Run npm run audio:build.`,
    );
  const bank = soundBank(await response.json(), base);
  await engine.start();
  await engine.scenes.push(new MusicLabScene(bank));
}
void main();
