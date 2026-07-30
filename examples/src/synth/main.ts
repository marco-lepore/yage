/**
 * Synth addon example — a listening bench for `@yagejs-addons/synth`.
 *
 * Every preset is registered through `SynthPlugin` at boot: no audio files
 * are loaded, and each alias plays through `AudioManager` like a preloaded
 * sound. Click a pad to hear it; the canvas draws the waveform the addon
 * rendered for it, which is the same `Float32Array` a unit test would assert
 * on. "Shoot" and "Footstep" are registered with four variants each and play
 * through `playRandom`, so repeats aren't identical.
 */

import { Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import {
  GraphicsComponent,
  RendererPlugin,
  TextComponent,
} from "@yagejs/renderer";
import { AudioManagerKey, AudioPlugin } from "@yagejs/audio";
import type { AudioManager, SoundHandle } from "@yagejs/audio";
import {
  renderSynthSound,
  SynthPlugin,
  synthPresets,
  synthVariantAliases,
  type SynthSound,
  type SynthSoundEntry,
} from "@yagejs-addons/synth";
import { setupGameContainer } from "../shared/bootstrap.js";

const WIDTH = 800;
const HEIGHT = 300;
const VARIANTS = 4;

interface Pad {
  alias: string;
  label: string;
  sound: SynthSound;
  /** Registered as `alias.1` … `alias.n` and played with `playRandom`. */
  variants?: number;
  /** Looping bed: the button toggles it instead of firing a one-shot. */
  loop?: boolean;
}

const PADS: Pad[] = [
  {
    alias: "shoot",
    label: "Shoot",
    sound: synthPresets.shoot(),
    variants: VARIANTS,
  },
  { alias: "hit", label: "Hit", sound: synthPresets.hit() },
  { alias: "explosion", label: "Explosion", sound: synthPresets.explosion() },
  { alias: "hurt", label: "Hurt", sound: synthPresets.hurt() },
  { alias: "pickup", label: "Pickup", sound: synthPresets.pickup() },
  { alias: "coin", label: "Coin", sound: synthPresets.coin() },
  { alias: "jump", label: "Jump", sound: synthPresets.jump() },
  { alias: "land", label: "Land", sound: synthPresets.land() },
  { alias: "dash", label: "Dash", sound: synthPresets.dash() },
  { alias: "powerup", label: "Powerup", sound: synthPresets.powerup() },
  {
    alias: "footstep",
    label: "Footstep (stone)",
    sound: synthPresets.footstep(),
    variants: VARIANTS,
  },
  {
    alias: "footstep-wood",
    label: "Footstep (wood)",
    sound: synthPresets.footstep({ surface: "wood" }),
  },
  {
    alias: "footstep-grass",
    label: "Footstep (grass)",
    sound: synthPresets.footstep({ surface: "grass" }),
  },
  { alias: "ui-click", label: "UI click", sound: synthPresets.uiClick() },
  { alias: "ui-blip", label: "UI blip", sound: synthPresets.uiBlip() },
  { alias: "alarm", label: "Alarm", sound: synthPresets.alarm() },
  { alias: "victory", label: "Victory", sound: synthPresets.victory() },
  { alias: "defeat", label: "Defeat", sound: synthPresets.defeat() },
  {
    alias: "ambience",
    label: "Room tone (loop)",
    sound: synthPresets.roomTone(),
    loop: true,
  },
  {
    alias: "wind",
    label: "Wind (loop)",
    sound: synthPresets.wind(),
    loop: true,
  },
  {
    alias: "dialogue-beeps",
    label: "Dialogue beeps (loop)",
    sound: synthPresets.dialogueBeeps(),
    loop: true,
  },
  // Not a preset: three layered voices, written by hand.
  {
    alias: "shotgun",
    label: "Shotgun (custom)",
    sound: [
      {
        wave: "sawtooth",
        frequency: 300,
        glideTo: 40,
        duration: 0.25,
        volume: 0.3,
      },
      {
        wave: "noise",
        duration: 0.3,
        volume: 0.3,
        filter: { type: "lowpass", frequency: 2000, sweepTo: 300 },
      },
      {
        wave: "square",
        frequency: 90,
        duration: 0.1,
        delay: 0.28,
        volume: 0.1,
      },
    ],
  },
];

function pluginSounds(): Record<string, SynthSoundEntry> {
  const sounds: Record<string, SynthSoundEntry> = {};
  for (const pad of PADS) {
    sounds[pad.alias] = pad.variants
      ? { sound: pad.sound, variants: pad.variants }
      : pad.sound;
  }
  return sounds;
}

// ---------------------------------------------------------------------------
// Waveform panel — draws the samples the addon rendered for the last pad.
// ---------------------------------------------------------------------------
const PANEL = { x: 40, y: 40, width: WIDTH - 80, height: HEIGHT - 120 };

function drawWaveform(gfx: GraphicsComponent, samples: Float32Array): void {
  const g = gfx.graphics;
  g.clear();
  g.rect(PANEL.x, PANEL.y, PANEL.width, PANEL.height).fill({ color: 0x11131c });
  g.rect(PANEL.x, PANEL.y, PANEL.width, PANEL.height).stroke({
    color: 0x2a2f42,
    width: 1,
  });

  const midY = PANEL.y + PANEL.height / 2;
  g.moveTo(PANEL.x, midY)
    .lineTo(PANEL.x + PANEL.width, midY)
    .stroke({
      color: 0x2a2f42,
      width: 1,
    });

  // One column per pixel: the min/max of the samples that fall in it.
  const columns = Math.floor(PANEL.width);
  const perColumn = samples.length / columns;
  for (let c = 0; c < columns; c++) {
    let min = 0;
    let max = 0;
    const from = Math.floor(c * perColumn);
    const to = Math.min(Math.floor((c + 1) * perColumn), samples.length);
    for (let i = from; i < to; i++) {
      const v = samples[i] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const x = PANEL.x + c;
    g.moveTo(x, midY - max * (PANEL.height / 2))
      .lineTo(x, midY - min * (PANEL.height / 2))
      .stroke({ color: 0x38bdf8, width: 1 });
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class SynthScene extends Scene {
  readonly name = "synth-bench";

  private readonly _loops = new Map<string, SoundHandle>();
  private readonly _buttons: HTMLButtonElement[] = [];

  onEnter(): void {
    const audio = this.use(AudioManagerKey);

    const panel = this.spawn("waveform");
    panel.add(new Transform({ position: new Vec2(0, 0) }));
    const gfx = panel.add(new GraphicsComponent());

    const caption = this.spawn("caption");
    caption.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT - 46) }));
    const label = caption.add(
      new TextComponent({
        text: "Click a pad to hear it — the waveform is what the addon rendered",
        style: { fontSize: 15, fill: 0x8892b0, fontFamily: "sans-serif" },
        anchor: { x: 0.5, y: 0.5 },
      }),
    );

    drawWaveform(gfx, renderSynthSound(PADS[0]?.sound ?? {}));

    this._buildPads(audio, (pad) => {
      drawWaveform(gfx, renderSynthSound(pad.sound));
      label.setText(`${pad.label} — ${describe(pad)}`);
    });
  }

  private _buildPads(audio: AudioManager, onPlay: (pad: Pad) => void): void {
    const host = document.getElementById("pads");
    if (!host) return;
    for (const pad of PADS) {
      const button = document.createElement("button");
      button.className = "pad";
      button.textContent = pad.label;
      button.addEventListener("click", () => {
        onPlay(pad);
        if (pad.loop) {
          this._toggleLoop(audio, pad, button);
        } else if (pad.variants) {
          audio.playRandom(synthVariantAliases(pad.alias, pad.variants));
        } else {
          audio.play(pad.alias);
        }
      });
      host.appendChild(button);
      this._buttons.push(button);
    }
  }

  onExit(): void {
    const audio = this.use(AudioManagerKey);
    for (const handle of this._loops.values()) audio.stop(handle);
    this._loops.clear();
    for (const button of this._buttons) button.remove();
    this._buttons.length = 0;
  }

  private _toggleLoop(
    audio: AudioManager,
    pad: Pad,
    button: HTMLButtonElement,
  ): void {
    const playing = this._loops.get(pad.alias);
    if (playing?.playing) {
      audio.stop(playing);
      this._loops.delete(pad.alias);
      button.classList.remove("on");
      return;
    }
    this._loops.set(
      pad.alias,
      audio.play(pad.alias, { loop: true, channel: "music" }),
    );
    button.classList.add("on");
  }
}

function describe(pad: Pad): string {
  if (pad.loop) return "seamless loop, played with loop: true";
  if (pad.variants) {
    // The registered takes are detuned copies; the canvas shows the base
    // patch they were made from.
    return `${pad.variants} detuned takes via playRandom — waveform is the base patch`;
  }
  return "one buffer, registered at boot";
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(new AudioPlugin());
  engine.use(new SynthPlugin({ sounds: pluginSounds() }));

  await engine.start();
  await engine.scenes.push(new SynthScene());
}

main().catch(console.error);
