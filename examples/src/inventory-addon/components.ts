import { Component, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import { InputManagerKey } from "@yagejs/input";
import type { InventorySource } from "@yagejs-addons/inventory";
import { HEIGHT, HUD_LAYER, ROOM_LAYER, WIDTH } from "./constants.js";
import { CATALOG, type DemoState, type ItemId } from "./catalog.js";

// ── world components ──────────────────────────────────────────────────────────

/** A floor bundle: walk over it and it pours into the right inventory.
 *  Partial acceptance is the point — only what fits leaves the floor. */
export class Pickup extends Component {
  private label?: TextComponent | undefined;
  /** True once a collect attempt was fully rejected this visit — stops the
   *  every-frame retry (and its repeating "bag full" toast) until the player
   *  steps out of range and back in. */
  private lingering = false;

  constructor(
    private readonly cfg: {
      readonly itemId: ItemId;
      quantity: number;
      readonly playerPos: () => Vec2;
      /** Pour into the game's inventories; returns how many were accepted. */
      readonly collect: (itemId: ItemId, quantity: number) => number;
    },
  ) {
    super();
  }

  onAdd(): void {
    const here = this.entity.get(Transform).position;
    const tip = this.scene.spawn("pickup-label");
    tip.add(new Transform({ position: new Vec2(here.x, here.y - 22) }));
    this.label = tip.add(
      new TextComponent({
        text: this.labelText(),
        style: { fontSize: 11, fill: 0xcccccc, fontFamily: "sans-serif" },
        layer: ROOM_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
  }

  onDestroy(): void {
    this.label?.entity.destroy();
    this.label = undefined;
  }

  update(): void {
    const me = this.entity.get(Transform).position;
    const pp = this.cfg.playerPos();
    if (Math.hypot(me.x - pp.x, me.y - pp.y) > 26) {
      this.lingering = false; // left range — a fresh approach may fit now
      return;
    }
    if (this.lingering) return; // already refused this visit; don't re-toast every frame
    const accepted = this.cfg.collect(this.cfg.itemId, this.cfg.quantity);
    if (accepted <= 0) {
      this.lingering = true; // stays on the floor (bag full / capped)
      return;
    }
    this.cfg.quantity -= accepted;
    if (this.cfg.quantity <= 0) this.entity.destroy();
    else if (this.label) this.label.text.text = this.labelText();
  }

  private labelText(): string {
    const name = CATALOG.get(this.cfg.itemId).name;
    return this.cfg.quantity > 1 ? `${name} ×${this.cfg.quantity}` : name;
  }
}

/** The vault door: interacting with it queries + consumes the gold key while
 *  every inventory panel is CLOSED — the model is just data the game reads. */
export class VaultDoor extends Component {
  private readonly input = this.service(InputManagerKey);
  private gfx!: GraphicsComponent;
  private prompt!: TextComponent;
  private open = false;

  constructor(
    private readonly cfg: {
      readonly playerPos: () => Vec2;
      readonly isBusy: () => boolean;
      readonly tryUnlock: () => boolean;
      readonly onOpened: () => void;
    },
  ) {
    super();
  }

  onAdd(): void {
    this.gfx = this.entity.add(new GraphicsComponent({ layer: ROOM_LAYER }));
    this.draw();
    const here = this.entity.get(Transform).position;
    const tip = this.scene.spawn("door-prompt");
    tip.add(new Transform({ position: new Vec2(here.x - 52, here.y) }));
    this.prompt = tip.add(
      new TextComponent({
        text: "E unlock",
        style: { fontSize: 12, fill: 0xffffff, fontFamily: "sans-serif" },
        layer: ROOM_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
    this.prompt.text.visible = false;
  }

  update(): void {
    if (this.open) return;
    const me = this.entity.get(Transform).position;
    const pp = this.cfg.playerPos();
    const near = !this.cfg.isBusy() && Math.hypot(me.x - pp.x, me.y - pp.y) <= 70;
    this.prompt.text.visible = near;
    if (near && this.input.isJustPressed("interact") && this.cfg.tryUnlock()) {
      this.open = true;
      this.prompt.text.visible = false;
      this.draw();
      this.cfg.onOpened();
    }
  }

  private draw(): void {
    this.gfx.draw((g) => {
      g.clear();
      g.roundRect(-16, -52, 32, 104, 4).fill({ color: this.open ? 0x1d3320 : 0x4a3826 });
      g.roundRect(-16, -52, 32, 104, 4).stroke({
        color: this.open ? 0x6be08a : 0xffd866,
        width: 2,
      });
      if (!this.open) g.circle(8, 0, 3).fill({ color: 0xffd866 });
    });
  }
}

/** HP bar + live potion counter + equipped line + a transient toast. */
export class Hud extends Component {
  private toastText!: TextComponent;
  private potionText!: TextComponent;
  private equippedText!: TextComponent;
  private hpGfx!: GraphicsComponent;
  private toastTtl = 0;

  constructor(private readonly state: DemoState) {
    super();
  }

  onAdd(): void {
    this.entity.add(new Transform());
    this.hpGfx = this.entity.add(new GraphicsComponent({ layer: HUD_LAYER }));
    // One entity per text node (an entity holds one component per class),
    // positioned through its Transform.
    const text = (
      x: number,
      y: number,
      size: number,
      fill: number,
      anchor = { x: 0, y: 0 },
      content = "",
    ): TextComponent => {
      const e = this.scene.spawn("hud-text");
      e.add(new Transform({ position: new Vec2(x, y) }));
      return e.add(
        new TextComponent({
          text: content,
          style: { fontSize: size, fill, fontFamily: "sans-serif" },
          layer: HUD_LAYER,
          anchor,
        }),
      );
    };
    this.potionText = text(WIDTH - 16, 14, 13, 0xf0f0f0, { x: 1, y: 0 });
    this.equippedText = text(WIDTH - 16, 34, 13, 0xc9c9de, { x: 1, y: 0 });
    // Toast at top-center (below the title): the bottom apron belongs to the hotbar.
    this.toastText = text(WIDTH / 2, 80, 14, 0xffd866, { x: 0.5, y: 0.5 });
    // Controls at the very bottom, below the hotbar strip.
    text(
      WIDTH / 2,
      HEIGHT - 14,
      11,
      0x8888aa,
      { x: 0.5, y: 0.5 },
      "WASD move · E interact · I backpack · K key items · R sort (open) · Esc close",
    );
  }

  toast(message: string): void {
    this.state.lastToast = message;
    this.toastText.text.text = message;
    this.toastTtl = 2.6;
  }

  update(dt: number): void {
    if (this.toastTtl > 0) {
      this.toastTtl -= dt;
      if (this.toastTtl <= 0) this.toastText.text.text = "";
    }
    this.potionText.text.text = `Potions: ${this.state.potions}`;
    this.equippedText.text.text = this.state.equipped
      ? `Equipped: ${CATALOG.get(this.state.equipped).name}`
      : "Equipped: —";
    this.hpGfx.draw((g) => {
      g.clear();
      g.roundRect(16, 14, 160, 14, 4).fill({ color: 0x26263e });
      if (this.state.hp > 0) {
        g.roundRect(16, 14, Math.max(8, 160 * (this.state.hp / 100)), 14, 4).fill({
          color: 0xff5566,
        });
      }
      g.roundRect(16, 14, 160, 14, 4).stroke({ color: 0x4a4a8a, width: 1 });
    });
  }
}

/** Quick-use belt: number keys 1–N fire the "use" action on the matching
 *  hotbar cell — a PRESENTED index into `inventory`, the same filtered
 *  view the hotbar panel shows, so key 1 always hits whatever the strip's
 *  first cell displays. Frozen while a panel is open (those keys drive the
 *  open panel then). */
export class HotbarQuickUse extends Component {
  private readonly input = this.service(InputManagerKey);

  constructor(
    private readonly cfg: {
      readonly inventory: InventorySource<ItemId>;
      readonly slots: number;
      readonly isBusy: () => boolean;
    },
  ) {
    super();
  }

  update(): void {
    if (this.cfg.isBusy()) return;
    for (let i = 0; i < this.cfg.slots; i++) {
      if (this.input.isJustPressed(`quick-${i + 1}`)) this.cfg.inventory.invokeAction("use", i);
    }
  }
}
