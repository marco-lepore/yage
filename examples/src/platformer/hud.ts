import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import { TextComponent, type TextComponentOptions } from "@yagejs/renderer";
import { AudioManagerKey } from "@yagejs/audio";
import {
  WIDTH,
  HEIGHT,
  HUD_LAYER,
  TOTAL_COINS,
  CoinCollected,
  GoalReached,
  CoinSfx,
  WinSfx,
} from "./constants.js";

// ---------------------------------------------------------------------------
// RunProgress — the run's game state and the HUD that shows it
// ---------------------------------------------------------------------------

/** The HUD texts `RunProgress` writes to. */
interface HudTexts {
  counter: TextComponent;
  banner: TextComponent;
  tally: TextComponent;
}

/**
 * Coin count and win state for one run. The component lives on the HUD
 * entity, so the state starts fresh every time the scene is entered. Code
 * outside the HUD reads it with
 * `scene.findByKey<HudEntity>(HUD_KEY)?.progress`.
 */
export class RunProgress extends Component {
  private readonly audio = this.service(AudioManagerKey);
  private readonly texts: HudTexts;
  private _coins = 0;
  private _won = false;

  constructor(texts: HudTexts) {
    super();
    this.texts = texts;
  }

  get coins(): number {
    return this._coins;
  }

  get won(): boolean {
    return this._won;
  }

  onAdd(): void {
    this.refresh();
    // Coins and the goal emit their events on themselves; the events bubble
    // to the scene, where this component hears them.
    this.listenScene(CoinCollected, () => {
      this._coins += 1;
      this.audio.play(CoinSfx, { channel: "sfx" });
      this.refresh();
    });
    this.listenScene(GoalReached, () => {
      if (this._won) return;
      this._won = true;
      this.audio.play(WinSfx, { channel: "sfx" });
      this.texts.tally.setText(
        `Collected ${this._coins} / ${TOTAL_COINS} coins`,
      );
      this.texts.banner.visible = true;
      this.texts.tally.visible = true;
    });
  }

  private refresh(): void {
    this.texts.counter.setText(`Coins: ${this._coins} / ${TOTAL_COINS}`);
  }
}

// ---------------------------------------------------------------------------
// HudEntity — in-canvas HUD on the screen-space layer
// ---------------------------------------------------------------------------

/** Spawn key of the HUD entity, for `scene.findByKey`. */
export const HUD_KEY = "hud";

/** Coin counter in the top-right corner and a centred win banner. */
export class HudEntity extends Entity {
  /** The run's state, hosted on this entity. */
  progress!: RunProgress;

  setup(): void {
    const counter = this.spawnHudText("counter", new Vec2(WIDTH - 16, 16), {
      text: "",
      anchor: { x: 1, y: 0 },
      style: { fontFamily: "monospace", fontSize: 20, fill: 0xffe66d },
    });
    const banner = this.spawnHudText(
      "banner",
      new Vec2(WIDTH / 2, HEIGHT / 2 - 12),
      {
        text: "You Win!",
        anchor: { x: 0.5, y: 0.5 },
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 32,
          fill: 0x22c55e,
          fontWeight: "bold",
        },
        visible: false,
      },
    );
    const tally = this.spawnHudText(
      "tally",
      new Vec2(WIDTH / 2, HEIGHT / 2 + 22),
      {
        text: "",
        anchor: { x: 0.5, y: 0.5 },
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 14,
          fill: 0xffe66d,
        },
        visible: false,
      },
    );
    this.progress = this.add(new RunProgress({ counter, banner, tally }));
  }

  /** One line of text as a child entity. The HUD entity has no Transform, so
   *  `position` is in screen pixels. */
  private spawnHudText(
    name: string,
    position: Vec2,
    options: TextComponentOptions,
  ): TextComponent {
    const child = this.spawnChild(name);
    child.add(new Transform({ position }));
    return child.add(new TextComponent({ ...options, layer: HUD_LAYER }));
  }
}
