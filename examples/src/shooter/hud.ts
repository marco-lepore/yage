import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import { TextComponent, type TextComponentOptions } from "@yagejs/renderer";
import {
  WIDTH,
  HEIGHT,
  HUD_LAYER,
  TOTAL_ENEMIES,
  EnemyKilled,
  AllEnemiesDefeated,
} from "./constants.js";

// ---------------------------------------------------------------------------
// RunProgress — the run's game state and the HUD that shows it
// ---------------------------------------------------------------------------

/** The HUD texts `RunProgress` writes to. */
interface HudTexts {
  counter: TextComponent;
  banner: TextComponent;
  subtitle: TextComponent;
}

/**
 * Kill count and win state for one run. The component lives on the HUD
 * entity, so the state starts fresh every time the scene is entered. Code
 * outside the HUD reads it with
 * `scene.findByKey<HudEntity>(HUD_KEY)?.progress`.
 */
export class RunProgress extends Component {
  private readonly texts: HudTexts;
  private _kills = 0;
  private _won = false;

  constructor(texts: HudTexts) {
    super();
    this.texts = texts;
  }

  get kills(): number {
    return this._kills;
  }

  get won(): boolean {
    return this._won;
  }

  onAdd(): void {
    this.refresh();
    // Enemies emit EnemyKilled on themselves; the event bubbles to the
    // scene, where this component hears it.
    this.listenScene(EnemyKilled, () => {
      this._kills += 1;
      this.refresh();
      if (this._kills >= TOTAL_ENEMIES) this.win();
    });
  }

  private win(): void {
    if (this._won) return;
    this._won = true;
    this.texts.banner.visible = true;
    this.texts.subtitle.visible = true;
    // The player listens for this and stops taking input.
    this.entity.emit(AllEnemiesDefeated);
  }

  private refresh(): void {
    this.texts.counter.setText(`Enemies: ${this._kills} / ${TOTAL_ENEMIES}`);
  }
}

// ---------------------------------------------------------------------------
// HudEntity — in-canvas HUD on the screen-space layer
// ---------------------------------------------------------------------------

/** Spawn key of the HUD entity, for `scene.findByKey`. */
export const HUD_KEY = "hud";

/** Enemy counter in the top-right corner and a centred win banner. */
export class HudEntity extends Entity {
  /** The run's state, hosted on this entity. */
  progress!: RunProgress;

  setup(): void {
    const counter = this.spawnHudText("counter", new Vec2(WIDTH - 16, 16), {
      text: "",
      anchor: { x: 1, y: 0 },
      style: { fontFamily: "monospace", fontSize: 18, fill: 0xef4444 },
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
    const subtitle = this.spawnHudText(
      "subtitle",
      new Vec2(WIDTH / 2, HEIGHT / 2 + 22),
      {
        text: "All enemies defeated",
        anchor: { x: 0.5, y: 0.5 },
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 14,
          fill: 0x38bdf8,
        },
        visible: false,
      },
    );
    this.progress = this.add(new RunProgress({ counter, banner, subtitle }));
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
