import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import { TextComponent } from "@yagejs/renderer";
import { HotbarActivationEvent } from "@yagejs-addons/hotbar";
import type { HotbarActivation } from "@yagejs-addons/hotbar";
import {
  HUD_LAYER,
  MAX_HEALTH,
  Notice,
  PLAYER_KEY,
  TARGET_KEY,
} from "./constants.js";
import { Backpack, LayoutKeys, Vitals } from "./player.js";
import { Dummy } from "./target.js";

// ---------------------------------------------------------------------------
// StatusPanel — health, potions, hits and the latest outcome
// ---------------------------------------------------------------------------

/**
 * The hotbar view shows what `read()` predicts. Outcomes, including an owner
 * rejecting a request, come from `HotbarActivationEvent`, which bubbles from
 * the player to the scene.
 */
export class StatusPanel extends Component {
  message = "Press 1 to zap the dummy.";
  private readonly stats: TextComponent;
  private readonly line: TextComponent;

  constructor(stats: TextComponent, line: TextComponent) {
    super();
    this.stats = stats;
    this.line = line;
  }

  onAdd(): void {
    this.listenScene(HotbarActivationEvent, (activation) => {
      this.message = describe(activation);
    });
    this.listenScene(Notice, (message) => {
      this.message = message;
    });
  }

  update(): void {
    const player = this.scene.findByKey(PLAYER_KEY);
    const target = this.scene.findByKey(TARGET_KEY);
    if (!player || !target) return;
    this.stats.setText(
      `Health ${player.get(Vitals).health}/${MAX_HEALTH}  ·  ` +
        `Potions ${player.get(Backpack).potions}  ·  ` +
        `Target hits ${target.get(Dummy).hits}  ·  ` +
        (player.get(LayoutKeys).editing ? "Editing" : "Playing"),
    );
    this.line.setText(this.message);
  }
}

function describe(activation: HotbarActivation): string {
  const name = activation.bindingId ?? "Empty slot";
  return activation.result.ok
    ? `${name} activated`
    : `${name} refused: ${activation.result.reason}`;
}

// ---------------------------------------------------------------------------
// HudEntity
// ---------------------------------------------------------------------------

export class HudEntity extends Entity {
  setup(): void {
    const stats = this.spawnText("stats", new Vec2(32, 32), 0xe4efff);
    const line = this.spawnText("message", new Vec2(32, 64), 0x66e3c4);
    this.add(new StatusPanel(stats, line));
  }

  /** One line of text as a child entity. The HUD entity has no Transform, so
   *  `position` is in screen pixels. */
  private spawnText(name: string, position: Vec2, fill: number): TextComponent {
    const child = this.spawnChild(name);
    child.add(new Transform({ position }));
    return child.add(
      new TextComponent({
        text: "",
        layer: HUD_LAYER,
        style: { fontFamily: "sans-serif", fontSize: 20, fill },
      }),
    );
  }
}
