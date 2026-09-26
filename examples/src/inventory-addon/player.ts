import { Component, Entity, MathUtils, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import { InputManagerKey } from "@yagejs/input";
import {
  BAG_KEY,
  HEIGHT,
  PLAYER_SPEED,
  PlayerStatsChanged,
  ROOM_LAYER,
  WIDTH,
} from "./constants.js";
import type { ItemId } from "./catalog.js";
import type { BagEntity } from "./bag.js";

// ---------------------------------------------------------------------------
// PlayerStats — HP and the equipped item
// ---------------------------------------------------------------------------

/**
 * The player's HP and equipped item. The item actions change them, the equip
 * actions' availability reads them, and the HUD shows them. Every change
 * emits `PlayerStatsChanged` on the player.
 */
export class PlayerStats extends Component {
  private readonly look = this.sibling(GraphicsComponent);
  private _hp = 55;
  private _equipped: ItemId | null = null;

  get hp(): number {
    return this._hp;
  }

  get equipped(): ItemId | null {
    return this._equipped;
  }

  onAdd(): void {
    this.draw();
  }

  /** Restore HP, up to 100. */
  heal(amount: number): void {
    this._hp = Math.min(100, this._hp + amount);
    this.entity.emit(PlayerStatsChanged);
  }

  equip(itemId: ItemId): void {
    this._equipped = itemId;
    this.draw();
    this.entity.emit(PlayerStatsChanged);
  }

  unequip(): void {
    this._equipped = null;
    this.draw();
    this.entity.emit(PlayerStatsChanged);
  }

  /** The player disc, with the equipped sword or shield beside it. */
  private draw(): void {
    this.look.draw((g) => {
      g.clear();
      g.circle(0, 0, 13).fill({ color: 0x6be08a });
      g.circle(0, 0, 13).stroke({ color: 0xffffff, width: 2, alpha: 0.7 });
      if (this._equipped === "sword") {
        g.moveTo(10, -4).lineTo(22, -16).stroke({ color: 0xc9c9de, width: 3 });
      } else if (this._equipped === "shield") {
        g.roundRect(10, -8, 8, 16, 3).fill({ color: 0xffa07a });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// PlayerMover — WASD/arrow movement
// ---------------------------------------------------------------------------

/** WASD/arrow movement, frozen while an inventory panel is open: the same
 *  arrows move the panel's cursor then. */
export class PlayerMover extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);

  update(dt: number): void {
    if (this.scene.findByKey<BagEntity>(BAG_KEY)?.panels.anyOpen) return;
    const dx = this.input.getAxis("move-left", "move-right");
    const dy = this.input.getAxis("move-up", "move-down");
    if (dx === 0 && dy === 0) return;
    const len = Math.hypot(dx, dy) || 1;
    const step = PLAYER_SPEED * dt;
    const p = this.transform.position;
    this.transform.setPosition(
      MathUtils.clamp(p.x + (dx / len) * step, 40, WIDTH - 40),
      MathUtils.clamp(p.y + (dy / len) * step, 110, HEIGHT - 90),
    );
  }
}

// ---------------------------------------------------------------------------
// PlayerEntity
// ---------------------------------------------------------------------------

/** The player. Spawned with `PLAYER_KEY`; pickups, the door and the item
 *  actions find it with `scene.findByKey`. */
export class PlayerEntity extends Entity {
  stats!: PlayerStats;

  setup(): void {
    this.add(new Transform({ position: new Vec2(160, 300) }));
    this.add(new GraphicsComponent({ layer: ROOM_LAYER }));
    this.stats = this.add(new PlayerStats());
    this.add(new PlayerMover());
  }
}
