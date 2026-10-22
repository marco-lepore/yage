import { Scene } from "@yagejs/core";
import type { LayerDef } from "@yagejs/renderer";
import {
  ALLY_SPOT,
  ARENA_TOP,
  COVER_WALL,
  GUARD_KEY,
  HEIGHT,
  HUD_LAYER,
  LABEL_LAYER,
  PLAYER_KEY,
  SHADE_LAYER,
  WIDTH,
} from "./constants.js";
import { GuardEntity } from "./guard.js";
import { HudEntity } from "./hud.js";
import { AllyEntity, ShadowEntity, WallEntity } from "./level.js";
import { LastKnownMarkerEntity } from "./overlays.js";
import { PlayerEntity } from "./player.js";

// ---------------------------------------------------------------------------
// PerceptionScene
// ---------------------------------------------------------------------------
export class PerceptionScene extends Scene {
  readonly name = "perception";
  readonly layers: readonly LayerDef[] = [
    { name: "default", order: 0 },
    { name: SHADE_LAYER, order: 10 },
    { name: LABEL_LAYER, order: 20 },
    { name: HUD_LAYER, order: 1000, space: "screen" },
  ];

  // The scene only assembles the level. Sight and memory live in the guard's
  // sensor; awareness, the search, and the HUD are components that read it.
  onEnter(): void {
    this.spawn(HudEntity);
    this.buildArena();
    this.spawn(ShadowEntity);
    this.spawn(AllyEntity, { position: ALLY_SPOT });
    this.spawn(PlayerEntity, { key: PLAYER_KEY });
    this.spawn(GuardEntity, { key: GUARD_KEY });
    this.spawn(LastKnownMarkerEntity);
  }

  private buildArena(): void {
    // The wall the player hides behind.
    this.spawn(WallEntity, {
      x: COVER_WALL.x,
      y: COVER_WALL.y,
      w: COVER_WALL.width,
      h: COVER_WALL.height,
    });
    // Bounds; the top edge separates the arena from the HUD.
    const middleY = (ARENA_TOP + HEIGHT) / 2;
    const arenaHeight = HEIGHT - ARENA_TOP;
    this.spawn(WallEntity, { x: WIDTH / 2, y: ARENA_TOP - 2, w: WIDTH, h: 4 });
    this.spawn(WallEntity, { x: WIDTH / 2, y: HEIGHT + 2, w: WIDTH, h: 4 });
    this.spawn(WallEntity, { x: -2, y: middleY, w: 4, h: arenaHeight });
    this.spawn(WallEntity, { x: WIDTH + 2, y: middleY, w: 4, h: arenaHeight });
  }
}
