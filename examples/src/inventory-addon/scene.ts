import { Scene, Transform, Vec2 } from "@yagejs/core";
import {
  CameraEntity,
  GraphicsComponent,
  TextComponent,
} from "@yagejs/renderer";
import {
  BAG_KEY,
  HEIGHT,
  LAYERS,
  PLAYER_KEY,
  ROOM_LAYER,
  WIDTH,
} from "./constants.js";
import type { ItemId } from "./catalog.js";
import { BagEntity } from "./bag.js";
import { HudEntity } from "./hud.js";
import { PlayerEntity } from "./player.js";
import { PickupEntity, VaultDoorEntity } from "./room.js";
import { InventoryProbe } from "./probe.js";

/** The floor loot: item, quantity, x, y. */
const FLOOR_LOOT: [ItemId, number, number, number][] = [
  ["potion", 2, 300, 220],
  ["potion", 1, 420, 180],
  ["potion", 3, 520, 300],
  ["elixir", 1, 250, 420],
  ["gem", 12, 360, 380],
  ["gem", 9, 610, 200],
  ["arrows", 20, 450, 460],
  ["arrows", 20, 560, 430], // second bundle: only 10 fit the 30-cap
  ["sword", 1, 200, 180],
  ["shield", 1, 660, 340],
  ["goldKey", 1, 640, 480],
  ["oldMap", 1, 300, 500],
];

// ── the scene ─────────────────────────────────────────────────────────────────

export class InventoryRoomScene extends Scene {
  readonly name = "inventory-addon";
  readonly layers = LAYERS;

  // The scene only assembles the room. The bag entity holds the inventories
  // and their panels; the pickups, the door and the HUD hold their own rules.
  onEnter(): void {
    this.drawRoom();
    const player = this.spawn(PlayerEntity, { key: PLAYER_KEY });
    this.spawn(CameraEntity, { position: new Vec2(WIDTH / 2, HEIGHT / 2) });
    const bag = this.spawn(BagEntity, { key: BAG_KEY });
    const hud = this.spawn(HudEntity);
    for (const [itemId, quantity, x, y] of FLOOR_LOOT) {
      this.spawn(PickupEntity, { itemId, quantity, x, y });
    }
    // The vault door works entirely against the CLOSED key-items model.
    this.spawn(VaultDoorEntity, { x: WIDTH - 26, y: 300 });
    this.spawn("inventory-probe").add(new InventoryProbe(player, bag, hud));
  }

  private drawRoom(): void {
    const bg = this.spawn("room-bg");
    bg.add(new Transform());
    bg.add(
      new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
        g.rect(0, 0, WIDTH, HEIGHT).fill({ color: 0x10101c });
        g.roundRect(24, 90, WIDTH - 48, HEIGHT - 160, 12).fill({
          color: 0x181828,
        });
        g.roundRect(24, 90, WIDTH - 48, HEIGHT - 160, 12).stroke({
          color: 0x2c2c4a,
          width: 2,
        });
        for (let x = 70; x < WIDTH - 60; x += 90) {
          for (let y = 140; y < HEIGHT - 110; y += 80) {
            g.circle(x, y, 1.6).fill({ color: 0x232338 });
          }
        }
      }),
    );
    const title = this.spawn("room-title");
    title.add(new Transform({ position: new Vec2(WIDTH / 2, 56) }));
    title.add(
      new TextComponent({
        text: "Scavenge the room — the vault wants a gold key",
        style: { fontSize: 15, fill: 0x8888aa, fontFamily: "sans-serif" },
        layer: ROOM_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
  }
}
