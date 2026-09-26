import {
  Component,
  Entity,
  ProcessComponent,
  Transform,
  Vec2,
  type ProcessSlot,
} from "@yagejs/core";
import {
  GraphicsComponent,
  TextComponent,
  type TextComponentOptions,
} from "@yagejs/renderer";
import {
  InventoryItemAddedEvent,
  InventoryItemRemovedEvent,
} from "@yagejs-addons/inventory";
import {
  BAG_KEY,
  HEIGHT,
  HUD_LAYER,
  PLAYER_KEY,
  PlayerStatsChanged,
  ShowToast,
  TOAST_SECONDS,
  WIDTH,
} from "./constants.js";
import { CATALOG } from "./catalog.js";
import type { BagEntity } from "./bag.js";
import type { PlayerEntity } from "./player.js";

// ---------------------------------------------------------------------------
// Hud — HP bar, potion counter, equipped line and toast
// ---------------------------------------------------------------------------

/** The HUD parts `Hud` writes to. */
interface HudParts {
  hpBar: GraphicsComponent;
  potions: TextComponent;
  equipped: TextComponent;
  toast: TextComponent;
}

/**
 * HP bar, live potion counter, equipped line and a toast that fades after
 * `TOAST_SECONDS`. Each part redraws only when the state behind it changes.
 */
export class Hud extends Component {
  private readonly processes = this.sibling(ProcessComponent);
  private readonly parts: HudParts;
  /** Running while the current toast is on screen. */
  private toastLife!: ProcessSlot;
  private _lastToast = "";

  constructor(parts: HudParts) {
    super();
    this.parts = parts;
  }

  /** The latest toast. It stays here after the toast fades. */
  get lastToast(): string {
    return this._lastToast;
  }

  onAdd(): void {
    this.toastLife = this.processes.slot({
      duration: TOAST_SECONDS,
      onComplete: () => this.parts.toast.setText(""),
    });
    // Toasts and stat changes are entity events that bubble to the scene.
    this.listenScene(ShowToast, ({ message }) => this.showToast(message));
    this.listenScene(PlayerStatsChanged, () => this.refreshStats());
    // Every inventory controller mirrors its model's add and remove events
    // onto its entity, panel open or closed. The counter recounts on any.
    this.listenScene(InventoryItemAddedEvent, () => this.refreshPotions());
    this.listenScene(InventoryItemRemovedEvent, () => this.refreshPotions());
    this.refreshStats();
    this.refreshPotions();
  }

  private showToast(message: string): void {
    this._lastToast = message;
    this.parts.toast.setText(message);
    this.toastLife.restart();
  }

  private refreshPotions(): void {
    const potions = this.scene.findByKey<BagEntity>(BAG_KEY)?.bag.potions;
    this.parts.potions.setText(`Potions: ${potions ?? 0}`);
  }

  private refreshStats(): void {
    const stats = this.scene.findByKey<PlayerEntity>(PLAYER_KEY)?.stats;
    if (!stats) return;
    const { hp, equipped } = stats;
    this.parts.equipped.setText(
      equipped ? `Equipped: ${CATALOG.get(equipped).name}` : "Equipped: —",
    );
    this.parts.hpBar.draw((g) => {
      g.clear();
      g.roundRect(16, 14, 160, 14, 4).fill({ color: 0x26263e });
      if (hp > 0) {
        g.roundRect(16, 14, Math.max(8, 160 * (hp / 100)), 14, 4).fill({
          color: 0xff5566,
        });
      }
      g.roundRect(16, 14, 160, 14, 4).stroke({ color: 0x4a4a8a, width: 1 });
    });
  }
}

// ---------------------------------------------------------------------------
// HudEntity — the HUD on the screen-space layer
// ---------------------------------------------------------------------------

/** The HUD. It reads the player and the bag when it mounts, so the scene
 *  spawns it after them. */
export class HudEntity extends Entity {
  hud!: Hud;

  setup(): void {
    const bar = this.spawnChild("hp-bar");
    bar.add(new Transform());
    const hpBar = bar.add(new GraphicsComponent({ layer: HUD_LAYER }));
    const potions = this.spawnHudText("potions", new Vec2(WIDTH - 16, 14), {
      text: "",
      style: { fontSize: 13, fill: 0xf0f0f0, fontFamily: "sans-serif" },
      anchor: { x: 1, y: 0 },
    });
    const equipped = this.spawnHudText("equipped", new Vec2(WIDTH - 16, 34), {
      text: "",
      style: { fontSize: 13, fill: 0xc9c9de, fontFamily: "sans-serif" },
      anchor: { x: 1, y: 0 },
    });
    // Top centre, below the title: the bottom apron belongs to the hotbar.
    const toast = this.spawnHudText("toast", new Vec2(WIDTH / 2, 80), {
      text: "",
      style: { fontSize: 14, fill: 0xffd866, fontFamily: "sans-serif" },
      anchor: { x: 0.5, y: 0.5 },
    });
    // Controls at the very bottom, below the hotbar strip.
    this.spawnHudText("controls", new Vec2(WIDTH / 2, HEIGHT - 14), {
      text: "WASD move · E interact · I backpack · K key items · R sort (open) · Esc close",
      style: { fontSize: 11, fill: 0x8888aa, fontFamily: "sans-serif" },
      anchor: { x: 0.5, y: 0.5 },
    });
    this.add(new ProcessComponent());
    this.hud = this.add(new Hud({ hpBar, potions, equipped, toast }));
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
