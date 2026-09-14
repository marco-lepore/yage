import { Entity, Transform } from "@yagejs/core";
import {
  defineLevelAsset,
  defineLevelEntity,
  defineParams,
  param,
  type ParamsOf,
} from "@yagejs/level";
import { TilemapComponent, tiledMap } from "@yagejs/tilemap";

// An arbitrary project-owned kind proves the editor does not identify maps by a label.
const mapAsset = defineLevelAsset({ kind: "terrain", create: tiledMap });
const params = defineParams({ map: param.asset(mapAsset, "maps/room.json") });

export class MapEntity extends Entity {
  static readonly level = defineLevelEntity({
    id: "game.map",
    version: 1,
    params,
  });
  setup(values: ParamsOf<typeof params>): void {
    this.add(new Transform());
    this.add(new TilemapComponent({ source: values.map }));
  }
}
