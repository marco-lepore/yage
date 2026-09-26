import {
  Engine,
  Scene,
  Component,
  Entity,
  Transform,
  Vec2,
  ProcessComponent,
  KeyframeAnimator,
  RandomKey,
  defineEvent,
  easeInOutQuad,
  type ProcessSlot,
} from "@yagejs/core";
import {
  RendererPlugin,
  GraphicsComponent,
  TextComponent,
} from "@yagejs/renderer";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import { AudioPlugin, AudioManagerKey, sound } from "@yagejs/audio";
import type { SoundHandle } from "@yagejs/audio";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";
import "./styles.css";

const WIDTH = 800;
const HEIGHT = 600;
const FLASH_SECONDS = 0.2;

// ---------------------------------------------------------------------------
// DOM status labels — the browser's audio state, written by AudioController.
// ---------------------------------------------------------------------------
function setUnlockLabel(unlocked: boolean): void {
  const el = document.getElementById("unlock-state");
  if (!el) return;
  el.textContent = unlocked ? "unlocked (running)" : "locked (press any key)";
  el.classList.toggle("unlocked", unlocked);
  el.classList.toggle("locked", !unlocked);
}

function setBlurLabel(on: boolean): void {
  const el = document.getElementById("blur-state");
  if (!el) return;
  el.textContent = on ? "on" : "off";
  el.classList.toggle("off", !on);
}

// ---------------------------------------------------------------------------
// Sound asset handles (loaded via scene preload)
// ---------------------------------------------------------------------------
const SFX_HANDLES = {
  laser_shot: sound("/assets/laser_gun_shot.wav"),
  laser_burst: sound("/assets/laser_gun_burst.wav"),
  explosion: sound("/assets/explosion.wav"),
} as const;

const BgMusic = sound("/assets/bgm.mp3");

type SfxAlias = keyof typeof SFX_HANDLES;

const SFX_ALIASES = Object.keys(SFX_HANDLES) as SfxAlias[];

// Colors and key label for each SFX pad
const SFX_PADS = {
  laser_shot: { fill: 0x38bdf8, stroke: 0x0ea5e9, key: "1", label: "SHOT" },
  laser_burst: { fill: 0x22c55e, stroke: 0x16a34a, key: "2", label: "BURST" },
  explosion: { fill: 0xf97316, stroke: 0xea580c, key: "3", label: "BOOM" },
} as const;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
/** A sound effect started playing. */
const SfxPlayed = defineEvent<{ alias: SfxAlias }>("audio:sfx-played");
/** Background music started or stopped. */
const MusicToggled = defineEvent<{ playing: boolean }>("audio:music-toggled");

// ---------------------------------------------------------------------------
// LabelBox — a line of text on a dark box
// ---------------------------------------------------------------------------
class LabelBox extends Entity {
  /** `position` is the centre of the box. */
  setup(params: {
    position: Vec2;
    width: number;
    height: number;
    text: string;
    fill: number;
    stroke?: number;
  }): void {
    const { width: w, height: h, stroke } = params;
    this.add(new Transform({ position: params.position }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color: params.fill });
        if (stroke !== undefined) {
          g.rect(-w / 2, -h / 2, w, h).stroke({ color: stroke, width: 1 });
        }
      }),
    );
    this.add(
      new TextComponent({
        text: params.text,
        anchor: { x: 0.5, y: 0.5 },
        style: { fontFamily: "monospace", fontSize: 11, fill: 0xcccccc },
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// SfxPad — a disc that flashes when its sound plays, and its key label
// ---------------------------------------------------------------------------
class FlashOnPlay extends Component {
  private readonly processes = this.sibling(ProcessComponent);
  private readonly alias: SfxAlias;
  private readonly disc: GraphicsComponent;
  private readonly discTransform: Transform;
  /** Running while the flash fades back to the resting look. */
  private flash!: ProcessSlot;

  constructor(options: {
    alias: SfxAlias;
    disc: GraphicsComponent;
    discTransform: Transform;
  }) {
    super();
    this.alias = options.alias;
    this.disc = options.disc;
    this.discTransform = options.discTransform;
  }

  onAdd(): void {
    this.flash = this.processes.slot({
      duration: FLASH_SECONDS,
      update: () => this.show(1 - this.flash.ratio),
    });
    this.show(0);
    this.listenScene(SfxPlayed, ({ alias }) => {
      if (alias === this.alias) this.flash.restart();
    });
  }

  /** Brightness and size for a flash strength from 0 (resting) to 1. */
  private show(strength: number): void {
    this.disc.alpha = 0.3 + 0.7 * strength;
    const scale = 1 + 0.3 * strength;
    this.discTransform.setScale(scale, scale);
  }
}

class SfxPad extends Entity {
  setup(params: { alias: SfxAlias; position: Vec2 }): void {
    const pad = SFX_PADS[params.alias];
    this.add(new Transform({ position: params.position }));
    // The disc is a child, so its flash scales it without moving the label.
    const disc = this.spawnChild("disc");
    const discTransform = disc.add(new Transform());
    const discVisual = disc.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 55).fill({ color: pad.fill, alpha: 0.3 });
        g.circle(0, 0, 55).stroke({ color: pad.stroke, width: 2 });
        g.circle(0, 0, 30).fill({ color: pad.fill, alpha: 0.6 });
      }),
    );
    this.spawnChild("key-label", LabelBox, {
      position: new Vec2(0, 80),
      width: 60,
      height: 20,
      text: `${pad.key} ${pad.label}`,
      fill: 0x222222,
      stroke: 0x444444,
    });
    this.add(new ProcessComponent());
    this.add(
      new FlashOnPlay({
        alias: params.alias,
        disc: discVisual,
        discTransform,
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// VolumeBarEntity — a horizontal bar showing a channel's volume
// ---------------------------------------------------------------------------
class VolumeBar extends Component {
  private readonly _channel: string;
  private readonly _color: number;
  private readonly _audio = this.service(AudioManagerKey);
  private readonly _gfx = this.sibling(GraphicsComponent);

  constructor(channel: string, color: number) {
    super();
    this._channel = channel;
    this._color = color;
  }

  update(): void {
    const vol = this._audio.getChannelVolume(this._channel);
    const g = this._gfx.graphics;
    g.clear();
    // Background
    g.rect(0, 0, 200, 20).fill({ color: 0x1a1a1a });
    g.rect(0, 0, 200, 20).stroke({ color: 0x333333, width: 1 });
    // Fill
    const w = Math.round(vol * 200);
    if (w > 0) {
      g.rect(0, 0, w, 20).fill({ color: this._color, alpha: 0.7 });
    }
  }
}

class VolumeBarEntity extends Entity {
  /** `position` is the bar's top-left corner. */
  setup(params: {
    channel: string;
    title: string;
    color: number;
    position: Vec2;
  }): void {
    this.add(new Transform({ position: params.position }));
    this.add(new GraphicsComponent());
    this.add(new VolumeBar(params.channel, params.color));
    this.spawnChild("title", LabelBox, {
      position: new Vec2(100, -12),
      width: 200,
      height: 16,
      text: params.title,
      fill: 0x111111,
    });
  }
}

// ---------------------------------------------------------------------------
// MusicDisc — pulses while music is playing (using KeyframeAnimator)
// ---------------------------------------------------------------------------
class MusicIndicator extends Component {
  private readonly _gfx = this.sibling(GraphicsComponent);
  private readonly _anim: KeyframeAnimator<"pulse">;

  constructor(anim: KeyframeAnimator<"pulse">) {
    super();
    this._anim = anim;
  }

  onAdd(): void {
    this.setPlaying(false);
    this.listenScene(MusicToggled, ({ playing }) => this.setPlaying(playing));
  }

  private setPlaying(v: boolean): void {
    if (v) {
      this._anim.play("pulse");
    } else {
      this._anim.stop("pulse");
      this._gfx.alpha = 0.2;
    }
  }
}

class MusicDisc extends Entity {
  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    const visual = this.add(
      new GraphicsComponent().draw((g) => {
        // Disc shape
        g.circle(0, 0, 35).fill({ color: 0xa78bfa, alpha: 0.2 });
        g.circle(0, 0, 35).stroke({ color: 0x7c3aed, width: 2 });
        g.circle(0, 0, 18).fill({ color: 0xa78bfa, alpha: 0.4 });
        g.circle(0, 0, 8).fill({ color: 0x7c3aed });
        // "Vinyl" lines
        g.circle(0, 0, 25).stroke({ color: 0x7c3aed, width: 1, alpha: 0.3 });
      }),
    );
    this.add(new ProcessComponent());
    const anim = this.add(
      new KeyframeAnimator<"pulse">({
        pulse: {
          keyframes: [
            { time: 0, data: 0.6 },
            { time: 0.525, data: 1.0 },
            { time: 1.05, data: 0.6 },
          ],
          setter: (alpha) => {
            visual.alpha = alpha as number;
          },
          loop: true,
          easing: easeInOutQuad,
        },
      }),
    );
    this.add(new MusicIndicator(anim));
  }
}

// ---------------------------------------------------------------------------
// AudioController — main controller handling all input
// ---------------------------------------------------------------------------
class AudioController extends Component {
  private readonly _audio = this.service(AudioManagerKey);
  private readonly _input = this.service(InputManagerKey);
  private _musicHandle: SoundHandle | null = null;
  private _muted = false;

  onAdd(): void {
    // Surface the AudioContext lock state to the page. Browsers suspend the
    // context until the first user gesture — onUnlock fires exactly once when
    // the context flips to "running" (or synchronously if already unlocked).
    setUnlockLabel(this._audio.isUnlocked());
    this.addCleanup(this._audio.onUnlock(() => setUnlockLabel(true)));
    setBlurLabel(this._audio.autoMuteOnBlur);
  }

  update(): void {
    // SFX triggers
    if (this._input.isJustPressed("sfx1")) this._playSfx("laser_shot");
    if (this._input.isJustPressed("sfx2")) this._playSfx("laser_burst");
    if (this._input.isJustPressed("sfx3")) this._playSfx("explosion");
    if (this._input.isJustPressed("random")) {
      this._playSfx(this.use(RandomKey).pick(SFX_ALIASES));
    }

    // Music toggle
    if (this._input.isJustPressed("music")) this._toggleMusic();

    // Volume controls
    if (this._input.isJustPressed("musicUp")) this._adjustVolume("music", 0.1);
    if (this._input.isJustPressed("musicDown"))
      this._adjustVolume("music", -0.1);
    if (this._input.isJustPressed("sfxUp")) this._adjustVolume("sfx", 0.1);
    if (this._input.isJustPressed("sfxDown")) this._adjustVolume("sfx", -0.1);

    // Master mute
    if (this._input.isJustPressed("muteAll")) {
      this._muted = !this._muted;
      if (this._muted) {
        this._audio.muteAll();
      } else {
        this._audio.unmuteAll();
      }
    }

    // Toggle autoMuteOnBlur — tab-away to hear the effect.
    if (this._input.isJustPressed("toggleBlurMute")) {
      this._audio.autoMuteOnBlur = !this._audio.autoMuteOnBlur;
      setBlurLabel(this._audio.autoMuteOnBlur);
    }
  }

  private _playSfx(alias: SfxAlias): void {
    this._audio.play(SFX_HANDLES[alias], { channel: "sfx" });
    this.entity.emit(SfxPlayed, { alias });
  }

  private _toggleMusic(): void {
    if (this._musicHandle?.playing) {
      this._audio.stop(this._musicHandle);
      this._musicHandle = null;
    } else {
      this._musicHandle = this._audio.play(BgMusic, {
        channel: "music",
        loop: true,
      });
    }
    this.entity.emit(MusicToggled, { playing: this._musicHandle !== null });
  }

  private _adjustVolume(channel: string, delta: number): void {
    const cur = this._audio.getChannelVolume(channel);
    const next = Math.max(0, Math.min(1, cur + delta));
    this._audio.setChannelVolume(channel, next);
  }
}

class MixerEntity extends Entity {
  setup(): void {
    this.add(new AudioController());
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class AudioScene extends Scene {
  readonly name = "audio-demo";
  readonly preload = [...Object.values(SFX_HANDLES), BgMusic];

  onEnter(): void {
    // --- SFX pads (three circles) ---
    const padY = 220;
    const padSpacing = 200;
    const padStartX = WIDTH / 2 - padSpacing;
    SFX_ALIASES.forEach((alias, i) => {
      this.spawn(SfxPad, {
        alias,
        position: new Vec2(padStartX + i * padSpacing, padY),
      });
    });

    // --- Music indicator ---
    this.spawn(MusicDisc, { position: new Vec2(WIDTH / 2, 380) });

    // --- Channel volume bars ---
    const barY = 470;
    this.spawn(VolumeBarEntity, {
      channel: "music",
      title: "MUSIC VOLUME",
      color: 0xa78bfa,
      position: new Vec2(WIDTH / 2 - 220, barY),
    });
    this.spawn(VolumeBarEntity, {
      channel: "sfx",
      title: "SFX VOLUME",
      color: 0x38bdf8,
      position: new Vec2(WIDTH / 2 + 20, barY),
    });

    // --- Decorative header line ---
    const header = this.spawn("header-line");
    header.add(new Transform({ position: new Vec2(WIDTH / 2, 100) }));
    header.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-300, 0, 600, 1).fill({ color: 0x333333 });
      }),
    );

    // --- Main controller ---
    this.spawn(MixerEntity);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(
    new InputPlugin({
      actions: {
        sfx1: ["Digit1"],
        sfx2: ["Digit2"],
        sfx3: ["Digit3"],
        random: ["KeyR"],
        music: ["KeyM"],
        musicUp: ["ArrowUp"],
        musicDown: ["ArrowDown"],
        sfxUp: ["ArrowRight"],
        sfxDown: ["ArrowLeft"],
        muteAll: ["Space"],
        toggleBlurMute: ["KeyB"],
      },
      preventDefaultKeys: ["Space", "ArrowUp", "ArrowDown"],
    }),
  );
  engine.use(new AudioPlugin());
  await installDebugFromUrl(engine);

  await engine.start();
  await engine.scenes.push(new AudioScene());
}

main().catch(console.error);
