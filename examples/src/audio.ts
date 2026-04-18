import { Engine, Scene, Component, Transform, Vec2, ProcessComponent, KeyframeAnimator, easeInOutQuad } from "@yagejs/core";
import { RendererPlugin, GraphicsComponent } from "@yagejs/renderer";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import { AudioPlugin, AudioManagerKey, SoundComponent, sound } from "@yagejs/audio";
import type { SoundHandle } from "@yagejs/audio";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, getContainer } from "./shared.js";

injectStyles(`
  .controls kbd { min-width: 24px; text-align: center; }
`);

const WIDTH = 800;
const HEIGHT = 600;

// ---------------------------------------------------------------------------
// Sound asset handles (loaded via scene preload)
// ---------------------------------------------------------------------------
const SFX_HANDLES = {
  laser_shot: sound("/assets/laser_gun_shot.wav"),
  laser_burst: sound("/assets/laser_gun_burst.wav"),
  explosion: sound("/assets/explosion.wav"),
} as const;

const BgMusic = sound("/assets/bgm.mp3");

const SFX_ALIASES = Object.keys(SFX_HANDLES) as (keyof typeof SFX_HANDLES)[];

// Colors for each SFX
const SFX_COLORS = {
  laser_shot: { fill: 0x38bdf8, stroke: 0x0ea5e9, label: "SHOT" },
  laser_burst: { fill: 0x22c55e, stroke: 0x16a34a, label: "BURST" },
  explosion: { fill: 0xf97316, stroke: 0xea580c, label: "BOOM" },
} as const;

// ---------------------------------------------------------------------------
// FlashOnPlay — visual ring that flashes when its SFX fires
// ---------------------------------------------------------------------------
class FlashOnPlay extends Component {
  private readonly _gfx = this.sibling(GraphicsComponent);
  private readonly _transform = this.sibling(Transform);
  private _timer = 0;

  update(dt: number): void {
    if (this._timer > 0) {
      this._timer = Math.max(0, this._timer - dt);
      const t = this._timer / 200;
      this._gfx.graphics.alpha = 0.3 + 0.7 * t;
      const s = 1 + 0.3 * t;
      this._transform.setScale(s, s);
    }
  }

  flash(): void {
    this._timer = 200;
  }
}

// ---------------------------------------------------------------------------
// VolumeBar — draws a horizontal bar reflecting a channel's volume
// ---------------------------------------------------------------------------
class VolumeBar extends Component {
  private _channel: string;
  private _color: number;
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

// ---------------------------------------------------------------------------
// MusicIndicator — pulses while music is playing (using KeyframeAnimator)
// ---------------------------------------------------------------------------
class MusicIndicator extends Component {
  private readonly _gfx = this.sibling(GraphicsComponent);
  private readonly _anim = this.sibling(KeyframeAnimator) as KeyframeAnimator<"pulse">;

  setPlaying(v: boolean): void {
    if (v) {
      this._anim.play("pulse");
    } else {
      this._anim.stop("pulse");
      this._gfx.graphics.alpha = 0.2;
    }
  }
}

// ---------------------------------------------------------------------------
// AudioController — main controller handling all input
// ---------------------------------------------------------------------------
class AudioController extends Component {
  private readonly _audio = this.service(AudioManagerKey);
  private readonly _input = this.service(InputManagerKey);
  private _flashers = new Map<string, FlashOnPlay>();
  private _musicHandle: SoundHandle | null = null;
  private _musicIndicator!: MusicIndicator;
  private _muted = false;

  setFlashers(map: Map<string, FlashOnPlay>): void {
    this._flashers = map;
  }

  setMusicIndicator(indicator: MusicIndicator): void {
    this._musicIndicator = indicator;
  }

  update(): void {
    // SFX triggers
    if (this._input.isJustPressed("sfx1")) this._playSfx("laser_shot");
    if (this._input.isJustPressed("sfx2")) this._playSfx("laser_burst");
    if (this._input.isJustPressed("sfx3")) this._playSfx("explosion");
    if (this._input.isJustPressed("random"))
      this._playSfx(
        SFX_ALIASES[Math.floor(Math.random() * SFX_ALIASES.length)]!,
      );

    // Music toggle
    if (this._input.isJustPressed("music")) this._toggleMusic();

    // Volume controls
    if (this._input.isJustPressed("musicUp"))
      this._adjustVolume("music", 0.1);
    if (this._input.isJustPressed("musicDown"))
      this._adjustVolume("music", -0.1);
    if (this._input.isJustPressed("sfxUp"))
      this._adjustVolume("sfx", 0.1);
    if (this._input.isJustPressed("sfxDown"))
      this._adjustVolume("sfx", -0.1);

    // Master mute
    if (this._input.isJustPressed("muteAll")) {
      this._muted = !this._muted;
      if (this._muted) {
        this._audio.muteAll();
      } else {
        this._audio.unmuteAll();
      }
    }
  }

  private _playSfx(alias: keyof typeof SFX_HANDLES): void {
    this._audio.play(SFX_HANDLES[alias].path, { channel: "sfx" });
    this._flashers.get(alias)?.flash();
  }

  private _toggleMusic(): void {
    if (this._musicHandle?.playing) {
      this._audio.stop(this._musicHandle);
      this._musicHandle = null;
      this._musicIndicator.setPlaying(false);
    } else {
      this._musicHandle = this._audio.play(BgMusic.path, {
        channel: "music",
        loop: true,
      });
      this._musicIndicator.setPlaying(true);
    }
  }

  private _adjustVolume(channel: string, delta: number): void {
    const cur = this._audio.getChannelVolume(channel);
    const next = Math.max(0, Math.min(1, cur + delta));
    this._audio.setChannelVolume(channel, next);
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class AudioScene extends Scene {
  readonly name = "audio-demo";
  readonly preload = [...Object.values(SFX_HANDLES), BgMusic];

  onEnter(): void {
    const flashers = new Map<string, FlashOnPlay>();

    // --- SFX pads (three circles) ---
    const padY = 220;
    const padSpacing = 200;
    const padStartX = WIDTH / 2 - padSpacing;

    SFX_ALIASES.forEach((alias, i) => {
      const x = padStartX + i * padSpacing;
      const colors = SFX_COLORS[alias];

      const pad = this.spawn(alias);
      pad.add(new Transform({ position: new Vec2(x, padY) }));
      pad.add(
        new GraphicsComponent().draw((g) => {
          g.circle(0, 0, 55).fill({ color: colors.fill, alpha: 0.3 });
          g.circle(0, 0, 55).stroke({ color: colors.stroke, width: 2 });
          g.circle(0, 0, 30).fill({ color: colors.fill, alpha: 0.6 });
        }),
      );
      const flash = pad.add(new FlashOnPlay());
      flashers.set(alias, flash);

      // Key label
      const label = this.spawn(`${alias}-label`);
      label.add(new Transform({ position: new Vec2(x, padY + 80) }));
      label.add(
        new GraphicsComponent().draw((g) => {
          g.rect(-30, -10, 60, 20).fill({ color: 0x222222 });
          g.rect(-30, -10, 60, 20).stroke({ color: 0x444444, width: 1 });
        }),
      );
    });

    // --- Music indicator ---
    const musicY = 380;
    const musicEnt = this.spawn("music-indicator");
    musicEnt.add(new Transform({ position: new Vec2(WIDTH / 2, musicY) }));
    const musicGfx = musicEnt.add(
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
    musicEnt.add(new ProcessComponent());
    musicEnt.add(new KeyframeAnimator({
      pulse: {
        keyframes: [
          { time: 0, data: 0.6 },
          { time: 525, data: 1.0 },
          { time: 1050, data: 0.6 },
        ],
        setter: (alpha) => { musicGfx.graphics.alpha = alpha as number; },
        loop: true,
        easing: easeInOutQuad,
      },
    }));
    const musicIndicator = musicEnt.add(new MusicIndicator());
    musicIndicator.setPlaying(false);

    // --- Channel volume bars ---
    const barY = 470;

    // Music volume
    const musicBar = this.spawn("music-vol");
    musicBar.add(
      new Transform({ position: new Vec2(WIDTH / 2 - 220, barY) }),
    );
    musicBar.add(new GraphicsComponent());
    musicBar.add(new VolumeBar("music", 0xa78bfa));

    // Music label
    const musicLabel = this.spawn("music-label");
    musicLabel.add(
      new Transform({ position: new Vec2(WIDTH / 2 - 220, barY - 20) }),
    );
    musicLabel.add(
      new GraphicsComponent().draw((g) => {
        g.rect(0, 0, 200, 16).fill({ color: 0x111111 });
      }),
    );

    // SFX volume
    const sfxBar = this.spawn("sfx-vol");
    sfxBar.add(
      new Transform({ position: new Vec2(WIDTH / 2 + 20, barY) }),
    );
    sfxBar.add(new GraphicsComponent());
    sfxBar.add(new VolumeBar("sfx", 0x38bdf8));

    // SFX label
    const sfxLabel = this.spawn("sfx-label");
    sfxLabel.add(
      new Transform({ position: new Vec2(WIDTH / 2 + 20, barY - 20) }),
    );
    sfxLabel.add(
      new GraphicsComponent().draw((g) => {
        g.rect(0, 0, 200, 16).fill({ color: 0x111111 });
      }),
    );

    // --- Decorative header lines ---
    const header = this.spawn("header-line");
    header.add(new Transform({ position: new Vec2(WIDTH / 2, 100) }));
    header.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-300, 0, 600, 1).fill({ color: 0x333333 });
      }),
    );

    // --- Entity with SoundComponent (demonstrates entity-bound audio) ---
    const ambientEntity = this.spawn("ambient-pad");
    ambientEntity.add(new Transform({ position: new Vec2(0, 0) }));
    ambientEntity.add(
      new SoundComponent({
        alias: BgMusic.path,
        channel: "music",
        loop: true,
        playOnAdd: false,
      }),
    );

    // --- Main controller ---
    const controller = this.spawn("controller");
    controller.add(new Transform());
    const ctrl = controller.add(new AudioController());
    ctrl.setFlashers(flashers);
    ctrl.setMusicIndicator(musicIndicator);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const engine = new Engine({ debug: true });

  engine.use(new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0a0a0a,
    container: getContainer(),
  }));
  engine.use(new InputPlugin({
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
    },
    preventDefaultKeys: ["Space", "ArrowUp", "ArrowDown"],
  }));
  engine.use(new AudioPlugin());
  engine.use(new DebugPlugin());

  await engine.start();
  await engine.scenes.push(new AudioScene());
}

main().catch(console.error);
