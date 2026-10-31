import { Entity, Transform } from "@yagejs/core";
import {
  buildLevelCatalog,
  defineLevelEntity,
  defineLevelProject,
  defineParams,
  param,
} from "@yagejs/level";
import { PlacementLayout } from "./PlacementLayout.js";
import type { PlacementOptions, PlacementTarget } from "./types.js";

const params = defineParams({ color: param.select("oak", ["oak", "teal"]) });
class Table extends Entity {
  static readonly level = defineLevelEntity({
    id: "table",
    version: 1,
    params,
  });
  setup(): void {
    this.add(new Transform());
  }
}
class Lamp extends Entity {
  static readonly level = defineLevelEntity({ id: "lamp", version: 1 });
  setup(): void {
    this.add(new Transform());
  }
}
class Wall extends Entity {
  static readonly level = defineLevelEntity({
    id: "wall",
    version: 1,
    params: defineParams({
      owner: param.entityRef({ types: ["table"], optional: true }),
    }),
  });
  setup(): void {
    this.add(new Transform());
  }
}
const built = buildLevelCatalog(
  defineLevelProject({ entities: [Table, Lamp, Wall] }),
);
if (!built.ok) throw new Error("Bad test catalog");
export const catalog = built.catalog;
export const target = (x: number, y = 100, rotation = 0): PlacementTarget => ({
  area: "room",
  pose: { x, y, rotation },
});
export const attached = (
  parent: string,
  socket = "top",
  x = 0,
  y = 0,
): PlacementTarget => ({
  area: "room",
  attachment: { parent, socket },
  pose: { x, y, rotation: 0 },
});
export function layout(
  options: Partial<PlacementOptions> = {},
): PlacementLayout {
  return new PlacementLayout({
    catalog,
    definitions: {
      table: {
        footprint: [{ x: -30, y: -20, width: 60, height: 40 }],
        variants: { teal: { color: "teal" }, oak: { color: "oak" } },
        sockets: {
          top: {
            pose: { x: 0, y: 0, rotation: 0 },
            surface: "surface",
            bounds: { x: -30, y: -20, width: 60, height: 40 },
            capacity: 2,
            accepts: ["lamp"],
          },
          end: {
            pose: { x: 40, y: 0, rotation: 0 },
            surface: "floor",
            accepts: ["wall"],
          },
        },
      },
      lamp: {
        footprint: [{ x: -5, y: -5, width: 10, height: 10 }],
        surfaces: ["surface", "wall"],
      },
      wall: {
        footprint: [{ x: -10, y: -20, width: 20, height: 40 }],
        sockets: {
          hook: {
            pose: { x: 0, y: 0, rotation: 0 },
            surface: "wall",
            accepts: ["lamp"],
          },
        },
      },
    },
    areas: {
      room: {
        bounds: { x: 0, y: 0, width: 500, height: 400 },
        finishes: { floor: ["oak", "tile"] },
      },
    },
    ...options,
  });
}
