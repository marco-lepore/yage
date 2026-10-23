import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import { AudioManagerKey } from "@yagejs/audio";
import { MUSIC_KEY, type MusicHostEntity } from "./director.js";

const LAMP_SPACING = 44;
const MAX_BEATS = 4;

/** One beat of the bar; lit while the music is on that beat. */
class BeatLampEntity extends Entity {
  lamp!: GraphicsComponent;

  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    this.lamp = this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 14).fill({ color: 0x38bdf8 });
        g.circle(0, 0, 14).stroke({ color: 0x7dd3fc, width: 2 });
      }),
    );
  }
}

/**
 * Shows the song, the beat and the mix. Music runs on the audio clock, so the
 * display reads the beat from the player instead of counting frames.
 */
class MusicReadout extends Component {
  private readonly audio = this.service(AudioManagerKey);

  constructor(
    private readonly text: TextComponent,
    private readonly lamps: readonly GraphicsComponent[],
  ) {
    super();
  }

  update(): void {
    const host = this.scene.findByKey<MusicHostEntity>(MUSIC_KEY);
    if (!host) {
      this.text.setText(
        "ADAPTIVE MUSIC\n\nThe music entity was removed, and its song and wind\nstopped with it. Reload the page to start again.",
      );
      for (const lamp of this.lamps) lamp.visible = false;
      return;
    }
    const { director } = host;
    const player = director.player;
    const music = player.getDiagnostics();
    const mixer = this.audio.getDiagnostics();
    const position = player.position();
    const beat = position ? Math.floor(position.beatInBar) : -1;
    this.lamps.forEach((lamp, i) => {
      lamp.visible = i < (position?.beatsPerBar ?? MAX_BEATS);
      lamp.alpha = i === beat ? 1 : 0.2;
    });

    const mix = director.offlineMix;
    this.text.setText(
      [
        "ADAPTIVE MUSIC",
        `${music.song ?? "Waiting"} · lead ${director.lead} · ${position?.bpm ?? "–"} BPM`,
        `Bar ${position ? position.bar + 1 : "–"} · danger ${director.intensity.toFixed(2)}`,
        `${mixer.activeVoices} voices · ${music.scheduledNotes} notes booked · ${music.droppedNotes} missed`,
        director.measuring
          ? "Rendering five seconds offline…"
          : mix
            ? `Offline mix: peak ${mix.samplePeak.toFixed(3)} · RMS ${mix.rms.toFixed(3)} · ${mix.clippedSamples} clipped`
            : "Measure the mix to render five seconds offline.",
        this.audio.isUnlocked()
          ? ""
          : "Click the page or press a key to start audio.",
      ].join("\n"),
    );
  }
}

/** Text readout plus a row of beat lamps under it. */
export class HudEntity extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(32, 28) }));
    const text = this.add(
      new TextComponent({
        text: "",
        style: {
          fontFamily: "monospace",
          fontSize: 18,
          fill: 0xcbd5f5,
          lineHeight: 32,
        },
      }),
    );
    const lamps: GraphicsComponent[] = [];
    for (let i = 0; i < MAX_BEATS; i++) {
      const lamp = this.spawnChild(`beat-${i}`, BeatLampEntity, {
        position: new Vec2(14 + i * LAMP_SPACING, 230),
      });
      lamps.push(lamp.lamp);
    }
    this.add(new MusicReadout(text, lamps));
  }
}
