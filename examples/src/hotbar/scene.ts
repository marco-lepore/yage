import { Scene, Transform } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import type { LayerDef } from "@yagejs/renderer";
import {
  FLOOR_Y,
  HUD_LAYER,
  PLAYER_KEY,
  TARGET_KEY,
  WIDTH,
  WORLD_LAYER,
} from "./constants.js";
import { HudEntity } from "./hud.js";
import { PlayerEntity } from "./player.js";
import { TargetEntity } from "./target.js";

export class HotbarScene extends Scene {
  readonly name = "hotbar";
  readonly layers: readonly LayerDef[] = [
    { name: WORLD_LAYER, order: 0 },
    { name: HUD_LAYER, order: 1000, space: "screen" },
  ];

  // Rules live in components: the player owns its abilities, bag and
  // hotbar, the dummy strikes back, and the HUD reports outcomes.
  onEnter(): void {
    const floor = this.spawn("floor");
    floor.add(new Transform());
    floor.add(
      new GraphicsComponent({ layer: WORLD_LAYER }).draw((g) => {
        g.moveTo(0, FLOOR_Y).lineTo(WIDTH, FLOOR_Y).stroke({
          color: 0x334b68,
          width: 2,
        });
      }),
    );
    this.spawn(HudEntity);
    this.spawn(TargetEntity, { key: TARGET_KEY });
    this.spawn(PlayerEntity, { key: PLAYER_KEY });
  }
}
