import {
  Component,
  Entity,
  ProcessComponent,
  Transform,
  Vec2,
  type ProcessSlot,
} from "@yagejs/core";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import { InputManagerKey } from "@yagejs/input";
import { Feel } from "@yagejs-addons/feel";
import {
  AUTOPLAY_FIRST_DELAY,
  AUTOPLAY_INTERVAL,
  HEIGHT,
  PAGE_COUNT,
  WIDTH,
  type PanelRect,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Demos — what a page hands to its showcase
// ---------------------------------------------------------------------------

/** A panel's demo. Its number key and autoplay call `play()`. */
export interface ShowcaseDemo {
  /** Shown as "Last cue" in the status line. */
  readonly label: string;
  play(): void;
}

/** A demo whose cue is the `"show"` cue of the `Feel` on the demo entity. */
export abstract class FeelDemo extends Entity implements ShowcaseDemo {
  abstract readonly label: string;

  play(): void {
    this.get(Feel).play("show");
  }
}

/** One line of bold, centred text. */
export class GalleryText extends Entity {
  setup(params: {
    position: Vec2;
    text: string;
    fontSize: number;
    fill: number;
  }): void {
    this.add(new Transform({ position: params.position }));
    this.add(
      new TextComponent({
        text: params.text,
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: params.fontSize,
          fontWeight: "bold",
          fill: params.fill,
          letterSpacing: 1,
        },
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// ShowcaseController — cue keys, autoplay and the status line
// ---------------------------------------------------------------------------

/**
 * Plays the page's demos from the number keys and, while autoplay is on,
 * one after another. The autoplay setting lives here; page navigation reads
 * it and hands it to the next page.
 */
export class ShowcaseController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly processes = this.sibling(ProcessComponent);
  private readonly page: number;
  private readonly demos: readonly ShowcaseDemo[];
  private readonly status: TextComponent;
  private _autoplay: boolean;
  private _lastCue = "waiting";
  private nextAutoplayCue = 0;
  /** Running while autoplay waits to play the next cue. */
  private autoplayTimer!: ProcessSlot;

  constructor(options: {
    page: number;
    autoplay: boolean;
    demos: readonly ShowcaseDemo[];
    status: TextComponent;
  }) {
    super();
    this.page = options.page;
    this._autoplay = options.autoplay;
    this.demos = options.demos;
    this.status = options.status;
  }

  /** Whether the demos play on their own. */
  get autoplay(): boolean {
    return this._autoplay;
  }

  /** Label of the demo that played last, or `"waiting"`. */
  get lastCue(): string {
    return this._lastCue;
  }

  onAdd(): void {
    this.autoplayTimer = this.processes.slot({
      duration: AUTOPLAY_INTERVAL,
      onComplete: () => this.playAutoplayCue(),
    });
    if (this._autoplay) {
      this.autoplayTimer.start({ duration: AUTOPLAY_FIRST_DELAY });
    }
    this.renderStatus();
  }

  update(): void {
    for (let index = 0; index < this.demos.length; index++) {
      if (!this.input.isJustPressed(`cue${index + 1}`)) continue;
      // A key press puts the next autoplay cue a full interval away.
      if (this._autoplay) this.autoplayTimer.restart();
      this.play(index);
    }
    if (this.input.isJustPressed("autoplay")) this.toggleAutoplay();
  }

  private toggleAutoplay(): void {
    this._autoplay = !this._autoplay;
    if (this._autoplay) this.autoplayTimer.restart();
    else this.autoplayTimer.cancel();
    this.renderStatus();
  }

  private playAutoplayCue(): void {
    this.play(this.nextAutoplayCue);
    this.nextAutoplayCue = (this.nextAutoplayCue + 1) % this.demos.length;
    this.autoplayTimer.start();
  }

  private play(index: number): void {
    const demo = this.demos[index];
    if (!demo) return;
    demo.play();
    this._lastCue = demo.label;
    this.renderStatus();
  }

  private renderStatus(): void {
    this.status.setText(
      `Page ${this.page + 1}/${PAGE_COUNT}  ·  Autoplay: ${this._autoplay ? "on" : "off"}  ·  Last cue: ${this._lastCue}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Page chrome
// ---------------------------------------------------------------------------

/** Page title and status line above the panels. Hosts the showcase state. */
export class GalleryHud extends Entity {
  /** The page's cue and autoplay state, hosted on this entity. */
  showcase!: ShowcaseController;

  setup(params: {
    page: number;
    autoplay: boolean;
    demos: readonly ShowcaseDemo[];
  }): void {
    this.spawnChild("title", GalleryText, {
      position: new Vec2(WIDTH / 2, 28),
      text: "COMPOSABLE GAME FEEL",
      fontSize: 22,
      fill: 0xf8fafc,
    });
    const status = this.spawnChild("status", GalleryText, {
      position: new Vec2(WIDTH / 2, 62),
      text: "",
      fontSize: 15,
      fill: 0x94a3b8,
    }).get(TextComponent);
    this.add(new ProcessComponent());
    this.showcase = this.add(new ShowcaseController({ ...params, status }));
  }
}

/** Grid background, the page's panels and their headings. */
export class GalleryBackdrop extends Entity {
  /** `titles[i]` is the heading of `panels[i]`. */
  setup(params: {
    panels: readonly PanelRect[];
    titles: readonly string[];
  }): void {
    const { panels, titles } = params;
    this.add(new Transform());
    this.add(
      new GraphicsComponent().draw((g) => {
        g.rect(0, 0, WIDTH, HEIGHT).fill({ color: 0x0f172a });
        for (let x = 0; x <= WIDTH; x += 40) {
          g.moveTo(x, 0)
            .lineTo(x, HEIGHT)
            .stroke({ color: 0x1e293b, width: 1 });
        }
        for (let y = 0; y <= HEIGHT; y += 40) {
          g.moveTo(0, y).lineTo(WIDTH, y).stroke({ color: 0x1e293b, width: 1 });
        }
        for (const panel of panels) {
          g.roundRect(panel.x, panel.y, panel.width, panel.height, 12).fill({
            color: 0x111827,
            alpha: 0.88,
          });
          g.roundRect(panel.x, panel.y, panel.width, panel.height, 12).stroke({
            color: 0x334155,
            width: 2,
          });
        }
      }),
    );
    panels.forEach((panel, index) => {
      this.spawnChild(`heading-${index + 1}`, GalleryText, {
        position: new Vec2(panel.x + panel.width / 2, panel.titleY),
        text: titles[index] ?? "",
        fontSize: 14,
        fill: 0x94a3b8,
      });
    });
  }
}
