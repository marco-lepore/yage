import { Component, Entity, MathUtils, Transform, Vec2 } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import {
  WIDTH,
  HEIGHT,
  HUD_LAYER,
  SKIP_HOLD,
  START_GOLD,
} from "./constants.js";

// ── Purse: the game state the conversations read and write ───────────────────

/**
 * The player's gold and items. The dialogue host bridges the scripts into it:
 * `gold` is a two-way storage cell, `has_item()` reads the items, and the
 * `give-gold` / `give-item` / `take-item` commands change them. The status line
 * redraws on every change.
 */
export class Purse extends Component {
  private _gold = START_GOLD;
  private readonly items = new Set<string>();

  constructor(private readonly status: TextComponent) {
    super();
  }

  get gold(): number {
    return this._gold;
  }

  set gold(value: number) {
    this._gold = value;
    this.refresh();
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  give(id: string): void {
    this.items.add(id);
    this.refresh();
  }

  take(id: string): void {
    this.items.delete(id);
    this.refresh();
  }

  onAdd(): void {
    this.refresh();
  }

  private refresh(): void {
    const bag = this.items.size > 0 ? [...this.items].join(", ") : "(empty)";
    this.status.setText(`Gold: ${this._gold}    Items: ${bag}`);
  }
}

// ── the fast-forward / skip meter ────────────────────────────────────────────

/** Bottom-centre meter: a fast-forward glyph while J is held, and a ring that
 *  fills while X is held (a full ring confirms the skip). */
export class InputMeter extends Component {
  private readonly input = this.service(InputManagerKey);
  /** Last-drawn state — the meter redraws only when it changes. */
  private ff = false;
  private skipHeld = false;
  private skipT = -1;

  constructor(private readonly meter: GraphicsComponent) {
    super();
  }

  update(): void {
    const ff = this.input.isPressed("attack");
    const skipHeld = this.input.isPressed("skip");
    const skipT = MathUtils.clamp(
      this.input.getHoldDuration("skip") / SKIP_HOLD,
      0,
      1,
    );
    if (ff === this.ff && skipHeld === this.skipHeld && skipT === this.skipT) {
      return;
    }
    this.ff = ff;
    this.skipHeld = skipHeld;
    this.skipT = skipT;
    this.meter.draw((g) => {
      g.clear();
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
}

// ── HUD entity (screen space) ────────────────────────────────────────────────

/** The options {@link spawnHudText} takes. */
export interface HudTextOptions {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly size: number;
  readonly fill: number;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly visible?: boolean;
}

/** One line of HUD text as a child entity of `parent`. HUD hosts have no
 *  Transform, so `x` and `y` are screen pixels. */
export function spawnHudText(
  parent: Entity,
  name: string,
  { x, y, text, size, fill, anchor, visible = true }: HudTextOptions,
): TextComponent {
  const child = parent.spawnChild(name);
  child.add(new Transform({ position: new Vec2(x, y) }));
  return child.add(
    new TextComponent({
      text,
      style: { fontSize: size, fill, fontFamily: "sans-serif" },
      layer: HUD_LAYER,
      anchor,
      visible,
    }),
  );
}

/** The controls hint, the gold + items line and the fast-forward meter. */
export class HudEntity extends Entity {
  /** The player's gold and items, hosted on this entity. */
  purse!: Purse;

  setup(): void {
    spawnHudText(this, "hint", {
      x: 12,
      y: 12,
      text: "WASD move · F talk · hold J fast · hold X skip · V auto · P pause · H hide",
      size: 13,
      fill: 0xb8b8c0,
      anchor: { x: 0, y: 0 },
    });
    const status = spawnHudText(this, "status", {
      x: 12,
      y: 34,
      text: "",
      size: 14,
      fill: 0xffe08a,
      anchor: { x: 0, y: 0 },
    });
    const meter = this.spawnChild("meter");
    meter.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT - 28) }));
    this.purse = this.add(new Purse(status));
    this.add(
      new InputMeter(meter.add(new GraphicsComponent({ layer: HUD_LAYER }))),
    );
  }
}
