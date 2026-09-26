import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import { InputManagerKey } from "@yagejs/input";
import {
  BAG_KEY,
  PLAYER_KEY,
  ROOM_LAYER,
  ShowToast,
  WIDTH,
} from "./constants.js";
import { CATALOG, type ItemId } from "./catalog.js";
import type { Bag, BagEntity } from "./bag.js";
import type { PlayerEntity } from "./player.js";

// ---------------------------------------------------------------------------
// Pickups
// ---------------------------------------------------------------------------

/** A floor bundle: walk over it and it pours into the right inventory.
 *  Partial acceptance is the point: only what fits leaves the floor. */
export class Pickup extends Component {
  private readonly transform = this.sibling(Transform);
  /** True once a collect attempt was fully refused on this visit. Stops the
   *  every-frame retry, and its repeating "bag full" toast, until the player
   *  steps out of range and back in. */
  private lingering = false;

  constructor(
    private readonly itemId: ItemId,
    private quantity: number,
    private readonly label: TextComponent,
  ) {
    super();
  }

  onAdd(): void {
    this.label.setText(this.labelText());
  }

  update(): void {
    const player = this.scene.findByKey<PlayerEntity>(PLAYER_KEY);
    const bag = this.scene.findByKey<BagEntity>(BAG_KEY)?.bag;
    if (!player || !bag) return;
    const me = this.transform.position;
    const pp = player.get(Transform).position;
    if (Math.hypot(me.x - pp.x, me.y - pp.y) > 26) {
      this.lingering = false; // left range: a fresh approach may fit now
      return;
    }
    if (this.lingering) return; // refused on this visit; don't toast every frame
    const accepted = bag.collect(this.itemId, this.quantity);
    if (accepted <= 0) {
      this.lingering = true; // stays on the floor (bag full or capped)
      return;
    }
    this.quantity -= accepted;
    if (this.quantity <= 0) this.entity.destroy();
    else this.label.setText(this.labelText());
  }

  private labelText(): string {
    const name = CATALOG.get(this.itemId).name;
    return this.quantity > 1 ? `${name} ×${this.quantity}` : name;
  }
}

/** A coloured tile on the floor with its name above it. The floor loot, the
 *  vault's treasure and dropped items are all pickups. */
export class PickupEntity extends Entity {
  setup(params: {
    itemId: ItemId;
    quantity: number;
    x: number;
    y: number;
  }): void {
    const { itemId, quantity, x, y } = params;
    const def = CATALOG.get(itemId);
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
        g.roundRect(-9, -9, 18, 18, 5).fill({
          color: def.color ?? 0xc9c9de,
          alpha: 0.95,
        });
        g.roundRect(-9, -9, 18, 18, 5).stroke({
          color: 0xffffff,
          width: 1.5,
          alpha: 0.5,
        });
      }),
    );
    // A child entity, so the label goes when the pickup does. Its position
    // is relative to the pickup.
    const tip = this.spawnChild("label");
    tip.add(new Transform({ position: new Vec2(0, -22) }));
    const label = tip.add(
      new TextComponent({
        text: "",
        style: { fontSize: 11, fill: 0xcccccc, fontFamily: "sans-serif" },
        layer: ROOM_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
    this.add(new Pickup(itemId, quantity, label));
  }
}

// ---------------------------------------------------------------------------
// The vault door
// ---------------------------------------------------------------------------

/** The vault door. It checks for the gold key and consumes it while every
 *  panel is closed: the model is data the game reads at any time. */
export class VaultDoor extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);
  private readonly look = this.sibling(GraphicsComponent);
  private open = false;

  constructor(private readonly prompt: TextComponent) {
    super();
  }

  onAdd(): void {
    this.draw();
  }

  update(): void {
    if (this.open) return;
    const player = this.scene.findByKey<PlayerEntity>(PLAYER_KEY);
    const host = this.scene.findByKey<BagEntity>(BAG_KEY);
    if (!player || !host) return;
    const me = this.transform.position;
    const pp = player.get(Transform).position;
    const near =
      !host.panels.anyOpen && Math.hypot(me.x - pp.x, me.y - pp.y) <= 70;
    this.prompt.visible = near;
    if (near && this.input.isJustPressed("interact")) this.tryUnlock(host.bag);
  }

  private tryUnlock(bag: Bag): void {
    if (!bag.keyItems.has("goldKey")) {
      this.toast("Locked. It wants a gold key.");
      return;
    }
    bag.keyItems.remove("goldKey", 1);
    this.open = true;
    this.prompt.visible = false;
    this.draw();
    this.toast("The vault opens! Treasure spills out.");
    this.scene.spawn(PickupEntity, {
      itemId: "gem",
      quantity: 30,
      x: WIDTH - 96,
      y: 250,
    });
    this.scene.spawn(PickupEntity, {
      itemId: "elixir",
      quantity: 1,
      x: WIDTH - 116,
      y: 350,
    });
  }

  private toast(message: string): void {
    this.entity.emit(ShowToast, { message });
  }

  private draw(): void {
    this.look.draw((g) => {
      g.clear();
      g.roundRect(-16, -52, 32, 104, 4).fill({
        color: this.open ? 0x1d3320 : 0x4a3826,
      });
      g.roundRect(-16, -52, 32, 104, 4).stroke({
        color: this.open ? 0x6be08a : 0xffd866,
        width: 2,
      });
      if (!this.open) g.circle(8, 0, 3).fill({ color: 0xffd866 });
    });
  }
}

/** The vault door on the right wall, with its "E unlock" prompt. */
export class VaultDoorEntity extends Entity {
  setup(params: { x: number; y: number }): void {
    this.add(new Transform({ position: new Vec2(params.x, params.y) }));
    this.add(new GraphicsComponent({ layer: ROOM_LAYER }));
    const tip = this.spawnChild("prompt");
    tip.add(new Transform({ position: new Vec2(-52, 0) }));
    const prompt = tip.add(
      new TextComponent({
        text: "E unlock",
        style: { fontSize: 12, fill: 0xffffff, fontFamily: "sans-serif" },
        layer: ROOM_LAYER,
        anchor: { x: 0.5, y: 0.5 },
        visible: false,
      }),
    );
    this.add(new VaultDoor(prompt));
  }
}
