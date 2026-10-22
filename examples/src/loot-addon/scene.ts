import { Scene } from "@yagejs/core";
import type { LayerDef } from "@yagejs/renderer";
import { AdventurerEntity } from "./adventurer.js";
import { ChestEntity } from "./chest.js";
import { HUD_LAYER, PANEL_LAYER } from "./constants.js";
import { HudEntity } from "./hud.js";

export class LootScene extends Scene {
  readonly name = "loot-addon";
  readonly layers: readonly LayerDef[] = [
    { name: PANEL_LAYER, order: 1040, space: "screen" },
    { name: HUD_LAYER, order: 1050, space: "screen" },
  ];

  // The scene only spawns. The chest rolls and holds unclaimed rewards, the
  // adventurer holds stats, inventories and loot progress, and the HUD shows
  // both and turns buttons and keys into calls on them.
  onEnter(): void {
    const adventurer = this.spawn(AdventurerEntity);
    const chest = this.spawn(ChestEntity);
    this.spawn(HudEntity, { chest, adventurer });
  }
}
