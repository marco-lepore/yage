import { Component, MathUtils, Transform, Vec2 } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import {
  DialogueChoiceShownEvent,
  DialogueChoiceMadeEvent,
  DialogueEndedEvent,
  type DialogueController,
} from "@yagejs-addons/dialogue";
import { WIDTH, HEIGHT, HUD_LAYER, SKIP_HOLD } from "./constants.js";

// ── HUD (screen space): hint, live gold + items, auto toggle, ff/skip ring ────

export class Hud extends Component {
  private readonly input = this.service(InputManagerKey);
  private auto = false;
  private autoLabel!: TextComponent;
  private status!: TextComponent;
  private lastStatus = "";
  private meter!: GraphicsComponent;
  /** Last-drawn meter state — redraw only on change (idle frames skip the
   *  Graphics clear+refill entirely). */
  private meterFf = false;
  private meterSkipHeld = false;
  private meterSkipT = -1;

  /** Set by the scene once the controller exists (toggled by the V key). */
  onAutoToggle?: (on: boolean) => void;

  constructor(
    private readonly getGold: () => number,
    private readonly getItems: () => readonly string[],
  ) {
    super();
  }

  onAdd(): void {
    this.spawnText(
      12,
      12,
      "WASD move · F talk · hold J fast · hold X skip · V auto · P pause · H hide",
      13,
      0xb8b8c0,
      { x: 0, y: 0 },
    );
    this.status = this.spawnText(12, 34, this.statusText(), 14, 0xffe08a, {
      x: 0,
      y: 0,
    });
    this.autoLabel = this.spawnText(
      WIDTH - 12,
      12,
      this.autoText(),
      13,
      0x8888aa,
      { x: 1, y: 0 },
    );

    const meterEntity = this.scene.spawn("hud-meter");
    meterEntity.add(
      new Transform({ position: new Vec2(WIDTH / 2, HEIGHT - 28) }),
    );
    this.meter = meterEntity.add(new GraphicsComponent({ layer: HUD_LAYER }));
  }

  update(): void {
    // Live gold + items — redraw only when the text actually changes.
    const next = this.statusText();
    if (next !== this.lastStatus) {
      this.lastStatus = next;
      this.status.setText(next);
    }

    if (this.input.isJustPressed("auto")) {
      this.auto = !this.auto;
      this.onAutoToggle?.(this.auto);
      this.autoLabel.setText(this.autoText());
    }

    // Bottom-centre meter: fast-forward glyph while J held; skip ring while X held.
    const ff = this.input.isPressed("attack");
    const skipHeld = this.input.isPressed("skip");
    const skipT = MathUtils.clamp(
      this.input.getHoldDuration("skip") / SKIP_HOLD,
      0,
      1,
    );
    if (
      ff === this.meterFf &&
      skipHeld === this.meterSkipHeld &&
      skipT === this.meterSkipT
    ) {
      return;
    }
    this.meterFf = ff;
    this.meterSkipHeld = skipHeld;
    this.meterSkipT = skipT;
    this.meter.graphics.clear(); // redrawn on change — don't accumulate
    this.meter.draw((g) => {
      if (ff) {
        g.poly([-9, -7, 0, 0, -9, 7]).fill({ color: 0xffffff, alpha: 0.9 });
        g.poly([1, -7, 10, 0, 1, 7]).fill({ color: 0xffffff, alpha: 0.9 });
      }
      if (skipHeld) {
        g.circle(0, 0, 13).stroke({ color: 0x333355, width: 3 });
        g.arc(
          0,
          0,
          13,
          -Math.PI / 2,
          -Math.PI / 2 + skipT * Math.PI * 2,
        ).stroke({
          color: skipT >= 1 ? 0x8ce06b : 0xffd866,
          width: 3,
        });
      }
    });
  }

  private statusText(): string {
    const items = this.getItems();
    const bag = items.length > 0 ? items.join(", ") : "(empty)";
    return `Gold: ${this.getGold()}    Items: ${bag}`;
  }

  private autoText(): string {
    return this.auto ? "AUTO ▶ ON" : "AUTO ❙❙ OFF";
  }

  private spawnText(
    x: number,
    y: number,
    text: string,
    size: number,
    fill: number,
    anchor: { x: number; y: number },
  ): TextComponent {
    const e = this.scene.spawn("hud-text");
    e.add(new Transform({ position: new Vec2(x, y) }));
    return e.add(
      new TextComponent({
        text,
        style: { fontSize: size, fill, fontFamily: "sans-serif" },
        layer: HUD_LAYER,
        anchor,
      }),
    );
  }
}

// ── Inspector probe (keeps the example harness-clean for smoke tests) ─────────

export class DialogueProbe extends Component {
  lastLine = "";
  lineCount = 0;
  lastChoice = "";

  onLine(text: string): void {
    this.lastLine = text;
    this.lineCount++;
  }
  onChoice(text: string): void {
    this.lastChoice = text;
  }
}

// ── Lifecycle levers on two keys (both persist across plays) ───────────────────

/**
 * P / H drive two of the three orthogonal lifecycle levers (the third,
 * `setInputEnabled`, toggles a live binding at runtime; the ambient gossip
 * below skips device input entirely with `input: null` instead):
 *   • **P → `setPaused`** — freezes every conversation (typewriter, auto-advance,
 *     caret, input) behind a dim overlay with no state loss; press again to
 *     resume exactly where it left off. `lifecycle.paused` freezes the player
 *     too, so the whole world reads as paused.
 *   • **H → `setHidden`** — hides the dialogue UI mid-line and brings it back
 *     with its reveal progress intact (the bubble + caret, never an empty box).
 *     Gated to an active conversation so an idle press can't strand a
 *     later line hidden.
 */
export class LifecycleControls extends Component {
  private readonly input = this.service(InputManagerKey);
  private overlay!: GraphicsComponent;
  private banner!: TextComponent;

  constructor(
    private readonly controllers: readonly DialogueController[],
    private readonly lifecycle: { paused: boolean; hidden: boolean },
  ) {
    super();
  }

  onAdd(): void {
    // Screen-space dim + PAUSED banner on the top HUD layer (above the dialogue
    // box), hidden until P. Toggled via `.visible` — DisplaySystem doesn't sync it.
    const dim = this.scene.spawn("pause-overlay");
    dim.add(new Transform());
    this.overlay = dim.add(
      new GraphicsComponent({ layer: HUD_LAYER }).draw((g) => {
        g.rect(0, 0, WIDTH, HEIGHT).fill({ color: 0x05060a, alpha: 0.55 });
      }),
    );
    this.overlay.graphics.visible = false;

    const banner = this.scene.spawn("pause-banner");
    banner.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }));
    this.banner = banner.add(
      new TextComponent({
        text: "❙❙ PAUSED",
        style: { fontSize: 34, fill: 0xffe08a, fontFamily: "sans-serif" },
        layer: HUD_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
    this.banner.text.visible = false;
  }

  update(): void {
    if (this.input.isJustPressed("pause")) {
      this.lifecycle.paused = !this.lifecycle.paused;
      for (const c of this.controllers) c.setPaused(this.lifecycle.paused);
      this.overlay.graphics.visible = this.lifecycle.paused;
      this.banner.text.visible = this.lifecycle.paused;
    }
    if (
      this.input.isJustPressed("hide") &&
      this.controllers.some((c) => c.isActive())
    ) {
      this.lifecycle.hidden = !this.lifecycle.hidden;
      for (const c of this.controllers) c.setHidden(this.lifecycle.hidden);
    }
  }
}

// ── timed-choice recipe: host-owned countdown on the game clock ───────────────

/**
 * Timed choices aren't an engine feature — they're this recipe. A non-blocking
 * `choice-timer` command stashes `{ seconds, default }`; the timer arms when the menu
 * is shown and commits the default option via `controller.choose` on expiry.
 * Two rules keep it honest:
 *
 *   • **Re-arm/cancel on every `DialogueChoiceShownEvent`** (and cancel on
 *     choice-made / ended). Without it, a timer armed for one menu could fire
 *     into a LATER, unrelated menu — the dangling-timer footgun.
 *   • **The countdown runs on `update(dt)` — the game clock** — so it must pause
 *     with the game. `setPaused` freezes the conversation but NOT this component,
 *     so the timer gates itself on the shared pause flag (pause your own timer).
 */
export class ChoiceTimer extends Component {
  private remaining = -1; // seconds left; < 0 = disarmed
  private pending: { seconds: number; def: number } | undefined;
  private def = 0;
  private label!: TextComponent;

  constructor(
    private readonly controller: DialogueController,
    private readonly isPaused: () => boolean,
  ) {
    super();
  }

  onAdd(): void {
    const e = this.scene.spawn("dlg-timer");
    e.add(new Transform({ position: new Vec2(WIDTH / 2, 70) }));
    this.label = e.add(
      new TextComponent({
        text: "",
        style: { fontSize: 20, fill: 0xff6b6b, fontFamily: "sans-serif" },
        layer: HUD_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
    this.label.text.visible = false;

    this.listen(this.entity, DialogueChoiceShownEvent, () => this.onShown());
    this.listen(this.entity, DialogueChoiceMadeEvent, () => this.cancel());
    this.listen(this.entity, DialogueEndedEvent, () => this.cancel());
  }

  /** The `choice-timer` command handler stashes its params here. */
  arm(seconds: number, def: number): void {
    this.pending = { seconds, def };
  }

  private onShown(): void {
    this.remaining = -1; // guard: drop any prior timer first…
    if (this.pending) {
      // …then re-arm only if THIS menu is timed.
      this.remaining = this.pending.seconds;
      this.def = this.pending.def;
      this.pending = undefined;
    }
    this.refresh();
  }

  private cancel(): void {
    this.remaining = -1;
    this.pending = undefined;
    this.label.text.visible = false;
  }

  update(dt: number): void {
    if (this.remaining < 0 || this.isPaused()) return; // pause your own timer
    this.remaining -= dt;
    if (this.remaining <= 0) {
      const def = this.def;
      this.remaining = -1;
      this.label.text.visible = false;
      this.controller.choose(def); // commit the default on expiry
      return;
    }
    this.refresh();
  }

  private refresh(): void {
    if (this.remaining < 0) {
      this.label.text.visible = false;
      return;
    }
    this.label.setText(`⏳ ${Math.ceil(this.remaining)}s`);
    this.label.text.visible = true;
  }
}
