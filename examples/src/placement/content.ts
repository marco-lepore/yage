import { Component, Entity, Transform } from "@yagejs/core";
import {
  buildLevelCatalog,
  defineLevelEntity,
  defineLevelProject,
  defineParams,
  param,
} from "@yagejs/level";
import type { ParamsOf } from "@yagejs/level";
import { drawIsoFurniture } from "./isometric.js";
import { GraphicsComponent } from "@yagejs/renderer";
import type { DrawContext } from "@yagejs/renderer";
import type {
  PlacementDefinition,
  PlacementPose,
  PlacementTarget,
} from "@yagejs-addons/placement";

export type RoomView = "topdown" | "side" | "isometric";
export type FurnitureType =
  | "table"
  | "chair"
  | "lamp"
  | "plant"
  | "floor"
  | "wall"
  | "art";
const Look = defineParams({
  finish: param.select("oak", ["oak", "teal", "rose"]),
  view: param.select("topdown", ["topdown", "side", "isometric"]),
});
export type Finish = ParamsOf<typeof Look>["finish"];
const palette = { oak: 0xc89560, teal: 0x66b8ac, rose: 0xd9969e };
const poses = (x: number, y: number): PlacementPose => ({ x, y, rotation: 0 });
export const at = (x: number, y: number, rotation = 0): PlacementTarget => ({
  area: "studio",
  pose: { x, y, rotation },
});
const variants = {
  oak: { finish: "oak" },
  teal: { finish: "teal" },
  rose: { finish: "rose" },
};
export const prices: Readonly<Record<FurnitureType, number>> = {
  table: 8,
  chair: 3,
  lamp: 2,
  plant: 2,
  floor: 5,
  wall: 4,
  art: 2,
};
export const labels: Readonly<Record<FurnitureType, string>> = {
  table: "Dining table",
  chair: "Lounge chair",
  lamp: "Table lamp",
  plant: "Potted plant",
  floor: "Floor section",
  wall: "Wall panel",
  art: "Picture",
};

export function roomDefinitions(
  view: RoomView,
): Readonly<Record<string, PlacementDefinition>> {
  const side = view === "side";
  const furniture: Record<string, PlacementDefinition> = {
    table: {
      label: labels.table,
      footprint: [
        side
          ? { x: -48, y: -72, width: 96, height: 72 }
          : { x: -48, y: -28, width: 96, height: 56 },
      ],
      variants,
      params: { view },
      sockets: {
        top: {
          pose: poses(0, side ? -72 : 0),
          surface: "surface",
          bounds: side
            ? { x: -42, y: -48, width: 84, height: 48 }
            : { x: -42, y: -22, width: 84, height: 44 },
          capacity: 3,
          radius: side ? 0 : 12,
          accepts: ["lamp", "plant"],
        },
      },
    },
    chair: {
      label: labels.chair,
      footprint: [
        side
          ? { x: -20, y: -64, width: 40, height: 64 }
          : { x: -20, y: -22, width: 40, height: 44 },
      ],
      variants,
      params: { view },
    },
    lamp: {
      label: labels.lamp,
      surfaces: ["surface"],
      footprint: [
        side
          ? { x: -14, y: -40, width: 28, height: 40 }
          : { x: -10, y: -10, width: 20, height: 20 },
      ],
      params: { view },
    },
    plant: {
      label: labels.plant,
      surfaces: ["floor", "surface"],
      footprint: [
        side
          ? { x: -16, y: -40, width: 32, height: 40 }
          : { x: -14, y: -14, width: 28, height: 28 },
      ],
      params: { view },
    },
  };
  if (!side) return furniture;
  return {
    ...furniture,
    floor: {
      label: labels.floor,
      footprint: [{ x: -80, y: 0, width: 160, height: 16 }],
      params: { view },
      sockets: {
        top: {
          pose: poses(0, 0),
          surface: "floor",
          accepts: ["table", "chair", "plant"],
          bounds: { x: -80, y: -280, width: 160, height: 280 },
          capacity: 8,
          radius: 0,
        },
        back: {
          pose: poses(0, 0),
          surface: "structure",
          accepts: ["wall"],
          radius: 0,
        },
        east: {
          pose: poses(160, 0),
          surface: "floor",
          accepts: ["floor"],
          radius: 24,
        },
        west: {
          pose: poses(-160, 0),
          surface: "floor",
          accepts: ["floor"],
          radius: 24,
        },
      },
    },
    wall: {
      label: labels.wall,
      surfaces: ["structure"],
      footprint: [{ x: -80, y: -192, width: 160, height: 192 }],
      params: { view },
      sockets: {
        art: {
          pose: poses(0, -136),
          surface: "wall",
          accepts: ["art"],
          bounds: { x: -64, y: -40, width: 128, height: 80 },
          capacity: 3,
          radius: 0,
        },
      },
    },
    art: {
      label: labels.art,
      surfaces: ["wall"],
      footprint: [{ x: -18, y: -14, width: 36, height: 28 }],
      params: { view },
    },
  };
}

/** The same drawing supplies catalog thumbnails, ghosts and committed furniture. */
export function drawFurniture(
  g: DrawContext,
  type: FurnitureType,
  finish: Finish,
  view: RoomView,
  rotation = 0,
): void {
  if (view === "isometric") {
    drawIsoFurniture(g, type, finish, rotation);
    return;
  }
  g.clear();
  const color = palette[finish],
    ink = 0x534336;
  if (view === "topdown") {
    if (type === "table") {
      g.roundRect(-48, -28, 96, 56, 8)
        .fill(color)
        .stroke({ color: ink, width: 2 });
      g.roundRect(-42, -22, 84, 44, 5).stroke({ color: 0xf5dec0, width: 1 });
      for (const x of [-16, 16])
        g.moveTo(x, -22)
          .lineTo(x, 22)
          .stroke({ color: ink, alpha: 0.18, width: 1 });
    } else if (type === "chair") {
      g.roundRect(-20, -22, 40, 44, 7).fill(ink);
      g.roundRect(-17, -19, 34, 38, 6).fill(color);
      g.roundRect(-13, -15, 26, 10, 4).fill({ color: 0xffffff, alpha: 0.28 });
      g.roundRect(-11, -1, 22, 17, 5).fill({ color: 0x000000, alpha: 0.12 });
      g.roundRect(-20, -7, 6, 26, 3).fill(color);
      g.roundRect(14, -7, 6, 26, 3).fill(color);
    } else if (type === "lamp") {
      g.circle(0, 0, 10).fill(0xf3d391).stroke({ color: 0x9b7750, width: 2 });
      g.circle(0, 0, 5).fill(0xfff6dc);
      for (const x of [-1, 1])
        g.moveTo(x * 4, x * 4)
          .lineTo(x * 8, x * 8)
          .stroke({ color: 0xd6b170, width: 1 });
    } else if (type === "plant") {
      g.circle(0, 0, 11).fill(0xba7959).stroke({ color: ink, width: 1 });
      g.ellipse(-5, -4, 6, 10).fill(0x72a887);
      g.ellipse(6, -1, 7, 10).fill(0x458367);
      g.ellipse(-2, 6, 8, 6).fill(0x8abd8c);
    }
    return;
  }
  if (type === "table") {
    g.rect(-41, -64, 8, 64).fill(ink);
    g.rect(33, -64, 8, 64).fill(ink);
    g.rect(-41, -35, 82, 5).fill(0xa67c51);
    g.roundRect(-48, -72, 96, 10, 3)
      .fill(color)
      .stroke({ color: ink, width: 2 });
  } else if (type === "chair") {
    g.rect(-15, -29, 6, 29).fill(ink);
    g.rect(10, -29, 6, 29).fill(ink);
    g.roundRect(-20, -64, 9, 39, 3)
      .fill(color)
      .stroke({ color: ink, width: 2 });
    g.roundRect(-20, -35, 40, 11, 3)
      .fill(color)
      .stroke({ color: ink, width: 2 });
  } else if (type === "lamp") {
    g.ellipse(0, -3, 12, 3).fill(0x85664b);
    g.rect(-2, -29, 4, 27).fill(0x96775b);
    g.poly([-9, -40, 9, -40, 14, -23, -14, -23])
      .fill(0xf3d391)
      .stroke({ color: ink, width: 1.5 });
  } else if (type === "plant") {
    g.poly([-11, -17, 11, -17, 7, 0, -7, 0])
      .fill(0xbd805e)
      .stroke({ color: ink, width: 1 });
    g.moveTo(0, -17).lineTo(0, -36).stroke({ color: 0x458367, width: 3 });
    g.ellipse(-7, -28, 8, 5).fill(0x6ca984);
    g.ellipse(8, -33, 8, 6).fill(0x458367);
    g.ellipse(-2, -37, 5, 3).fill(0x8abd8c);
  } else if (type === "floor") {
    g.rect(-80, 0, 160, 16).fill(0x9b7654).stroke({ color: ink, width: 2 });
    g.rect(-80, 0, 160, 4).fill(0xd9b587);
    for (let x = -60; x < 80; x += 40)
      g.moveTo(x, 4).lineTo(x, 16).stroke({ color: ink, alpha: 0.4, width: 1 });
  } else if (type === "wall") {
    g.rect(-80, -192, 160, 192)
      .fill(0xd9e0d0)
      .stroke({ color: 0x859789, width: 2 });
    g.rect(-80, -192, 160, 7).fill(0xb6c9b9);
    for (let x = -48; x < 80; x += 32)
      g.moveTo(x, -185)
        .lineTo(x, 0)
        .stroke({ color: 0x849b8c, alpha: 0.25, width: 1 });
    g.rect(-80, -8, 160, 8).fill(0x859789);
  } else {
    g.roundRect(-18, -14, 36, 28, 2).fill(0x91694c);
    g.rect(-14, -10, 28, 20).fill(0xf3e4c7);
    g.circle(6, -4, 4).fill(0xd88e6d);
    g.poly([-14, 10, -3, -2, 11, 10]).fill(0x719a88);
  }
}

export class FurnitureLook extends Component {
  private readonly graphics = this.sibling(GraphicsComponent);
  constructor(
    readonly type: FurnitureType,
    readonly view: RoomView,
  ) {
    super();
  }
  setFinish(finish: Finish, rotation = 0): void {
    this.graphics.draw((g) =>
      drawFurniture(g, this.type, finish, this.view, rotation),
    );
  }
}
class Furniture extends Entity {
  protected kind: FurnitureType = "table";
  setup(params: ParamsOf<typeof Look>): void {
    this.add(new Transform());
    this.add(
      new GraphicsComponent({
        layer:
          this.kind === "floor"
            ? "floor-modules"
            : this.kind === "wall"
              ? "walls"
              : "furniture",
      }),
    );
    this.add(new FurnitureLook(this.kind, params.view)).setFinish(
      params.finish,
    );
  }
}
class Table extends Furniture {
  static readonly level = defineLevelEntity({
    id: "table",
    version: 1,
    params: Look,
  });
}
class Chair extends Furniture {
  static readonly level = defineLevelEntity({
    id: "chair",
    version: 1,
    params: Look,
  });
  protected override kind = "chair" as const;
}
class Lamp extends Furniture {
  static readonly level = defineLevelEntity({
    id: "lamp",
    version: 1,
    params: Look,
  });
  protected override kind = "lamp" as const;
}
class Plant extends Furniture {
  static readonly level = defineLevelEntity({
    id: "plant",
    version: 1,
    params: Look,
  });
  protected override kind = "plant" as const;
}
class Floor extends Furniture {
  static readonly level = defineLevelEntity({
    id: "floor",
    version: 1,
    params: Look,
  });
  protected override kind = "floor" as const;
}
class Wall extends Furniture {
  static readonly level = defineLevelEntity({
    id: "wall",
    version: 1,
    params: Look,
  });
  protected override kind = "wall" as const;
}
class Art extends Furniture {
  static readonly level = defineLevelEntity({
    id: "art",
    version: 1,
    params: Look,
  });
  protected override kind = "art" as const;
}
const built = buildLevelCatalog(
  defineLevelProject({
    entities: [Table, Chair, Lamp, Plant, Floor, Wall, Art],
  }),
);
if (!built.ok) throw new Error(built.errors.map((e) => e.message).join("\n"));
export const catalog = built.catalog;
