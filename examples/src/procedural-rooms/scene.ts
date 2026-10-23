import { Scene } from "@yagejs/core";
import { CameraEntity, type LayerDef } from "@yagejs/renderer";
import {
  CONTENT_LAYER,
  HUD_LAYER,
  MAP_LAYER,
  OVERLAY_LAYER,
} from "./constants.js";
import { ExplorerEntity } from "./explorer.js";
import { HudEntity } from "./hud.js";
import { MapHost } from "./map.js";
import { BoardEntity, RouteEntity } from "./view.js";

// ---------------------------------------------------------------------------
// ProceduralRoomsScene
// ---------------------------------------------------------------------------
export class ProceduralRoomsScene extends Scene {
  readonly name = "procedural-rooms";
  readonly layers: readonly LayerDef[] = [
    { name: MAP_LAYER, order: 0 },
    { name: CONTENT_LAYER, order: 1 },
    { name: OVERLAY_LAYER, order: 2 },
    { name: HUD_LAYER, order: 1000, space: "screen" },
  ];

  // The scene only assembles. The map host generates and keeps the run's
  // state; the explorer walks; the board, route and HUD draw.
  onEnter(): void {
    const camera = this.spawn(CameraEntity);
    const map = this.spawn(MapHost).state;
    this.spawn(BoardEntity, { map, camera });
    const explorer = this.spawn(ExplorerEntity, { map }).explorer;
    this.spawn(RouteEntity, { map, explorer });
    this.spawn(HudEntity, { map, explorer });
  }
}
