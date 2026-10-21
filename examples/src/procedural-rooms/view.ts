import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import type { CameraEntity, GraphicsContext } from "@yagejs/renderer";
import { isRoomLayoutWalkable } from "@yagejs-addons/procedural";
import type {
  CatalogSelection,
  RoomLayout,
  TileMap,
} from "@yagejs-addons/procedural";
import {
  COLORS,
  HEIGHT,
  HUD_HEIGHT,
  KeyCollected,
  MAP_LAYER,
  MapChanged,
  OVERLAY_LAYER,
  RouteChanged,
  TILE,
  WIDTH,
} from "./constants.js";
import type { Explorer } from "./explorer.js";
import type { MapState } from "./map.js";

const NODE_SPACING = { x: 96, y: 64 };
const NODE_RADIUS = 14;

/**
 * Where the game draws each region of a catalog selection. The selection has
 * no positions, so this game lays regions out by their distance from the
 * start: one column per step. Each column keeps the breadth-first visit
 * order, so a parent's children sit together and tree edges do not cross.
 */
export function catalogNodePositions(
  selection: CatalogSelection,
): ReadonlyMap<string, Vec2> {
  const depth = new Map([[selection.start, 0]]);
  const queue = [selection.start];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const edge of selection.connections) {
      const other =
        edge.from === id ? edge.to : edge.to === id ? edge.from : undefined;
      if (other === undefined || depth.has(other)) continue;
      depth.set(other, depth.get(id)! + 1);
      queue.push(other);
    }
  }
  const columns = new Map<number, string[]>();
  for (const id of queue) {
    const column = depth.get(id)!;
    columns.set(column, [...(columns.get(column) ?? []), id]);
  }
  const positions = new Map<string, Vec2>();
  for (const [column, ids] of columns)
    ids.forEach((id, row) =>
      positions.set(
        id,
        new Vec2(
          column * NODE_SPACING.x,
          (row - (ids.length - 1) / 2) * NODE_SPACING.y,
        ),
      ),
    );
  return positions;
}

function regionColor(metadata: { readonly [key: string]: unknown }): number {
  return typeof metadata["color"] === "number"
    ? metadata["color"]
    : COLORS.floor;
}

// ---------------------------------------------------------------------------
// MapView — the generated map, redrawn when it changes or a lock opens
// ---------------------------------------------------------------------------

export class MapView extends Component {
  private readonly board = this.sibling(GraphicsComponent);
  constructor(
    private readonly map: MapState,
    private readonly camera: CameraEntity,
  ) {
    super();
  }

  onAdd(): void {
    this.listen(this.map.entity, MapChanged, () => {
      this.redraw();
      this.frame();
    });
    // A collected key opens locked rooms, which change colour.
    this.listenScene(KeyCollected, () => this.redraw());
    this.redraw();
  }

  private redraw(): void {
    const { layout, selection, cave } = this.map;
    this.board.draw((g) => {
      g.clear();
      if (layout) this.drawRooms(g, layout);
      else if (selection) this.drawCatalog(g, selection);
      else if (cave) this.drawCave(g, cave);
    });
  }

  private drawRooms(g: GraphicsContext, layout: RoomLayout): void {
    for (const room of layout.regions) {
      const color = regionColor(room.metadata);
      for (let y = room.y; y < room.y + room.height; y++)
        for (let x = room.x; x < room.x + room.width; x++) {
          const tile = { x, y };
          const fill = isRoomLayoutWalkable(layout, tile, this.map.hasKey)
            ? color
            : isRoomLayoutWalkable(layout, tile, () => true)
              ? COLORS.locked
              : COLORS.wall;
          g.rect(x * TILE, y * TILE, TILE, TILE).fill(fill);
        }
      g.rect(
        room.x * TILE,
        room.y * TILE,
        room.width * TILE,
        room.height * TILE,
      ).stroke({ color: COLORS.outline, width: 1 });
    }
  }

  private drawCatalog(g: GraphicsContext, selection: CatalogSelection): void {
    const positions = catalogNodePositions(selection);
    for (const edge of selection.connections) {
      const a = positions.get(edge.from)!,
        b = positions.get(edge.to)!;
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({
        color: COLORS.link,
        width: 3,
      });
    }
    for (const region of selection.regions) {
      const p = positions.get(region.id)!;
      g.circle(p.x, p.y, NODE_RADIUS).fill(regionColor(region.metadata));
      if (region.requires?.length)
        g.circle(p.x, p.y, NODE_RADIUS + 4).stroke({
          color: COLORS.boss,
          width: 2,
        });
    }
  }

  private drawCave(g: GraphicsContext, cave: TileMap): void {
    cave.cells.forEach((row, y) =>
      [...row].forEach((cell, x) =>
        g
          .rect(
            (cave.origin.x + x) * TILE,
            (cave.origin.y + y) * TILE,
            TILE,
            TILE,
          )
          .fill(cell === "." ? COLORS.caveFloor : COLORS.wall),
      ),
    );
  }

  /** World-pixel rectangle the current map covers, or null before a result. */
  private bounds(): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null {
    const { layout, selection, cave } = this.map;
    if (layout) {
      const left = Math.min(...layout.regions.map((r) => r.x)),
        top = Math.min(...layout.regions.map((r) => r.y)),
        right = Math.max(...layout.regions.map((r) => r.x + r.width)),
        bottom = Math.max(...layout.regions.map((r) => r.y + r.height));
      return {
        x: left * TILE,
        y: top * TILE,
        width: (right - left) * TILE,
        height: (bottom - top) * TILE,
      };
    }
    if (selection) {
      const points = [...catalogNodePositions(selection).values()];
      const pad = NODE_RADIUS * 2;
      const left = Math.min(...points.map((p) => p.x)) - pad,
        top = Math.min(...points.map((p) => p.y)) - pad;
      return {
        x: left,
        y: top,
        width: Math.max(...points.map((p) => p.x)) + pad - left,
        height: Math.max(...points.map((p) => p.y)) + pad - top,
      };
    }
    if (cave)
      return {
        x: cave.origin.x * TILE,
        y: cave.origin.y * TILE,
        width: cave.cells[0]!.length * TILE,
        height: cave.cells.length * TILE,
      };
    return null;
  }

  /** Fits the map below the HUD band. */
  private frame(): void {
    const bounds = this.bounds();
    if (!bounds) return;
    const zoom = Math.min(
      (WIDTH - 80) / bounds.width,
      (HEIGHT - HUD_HEIGHT - 40) / bounds.height,
    );
    this.camera.zoom = zoom;
    this.camera.position = new Vec2(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2 - HUD_HEIGHT / 2 / zoom,
    );
  }
}

/** Draws the map on the map layer. */
export class BoardEntity extends Entity {
  setup(params: { map: MapState; camera: CameraEntity }): void {
    this.add(new Transform());
    this.add(new GraphicsComponent({ layer: MAP_LAYER }));
    this.add(new MapView(params.map, params.camera));
  }
}

// ---------------------------------------------------------------------------
// RouteView — the explorer's target and the route ahead
// ---------------------------------------------------------------------------

export class RouteView extends Component {
  private readonly overlay = this.sibling(GraphicsComponent);
  constructor(
    private readonly map: MapState,
    private readonly explorer: Explorer,
  ) {
    super();
  }

  onAdd(): void {
    this.listenScene(RouteChanged, () => this.redraw());
    this.listen(this.map.entity, MapChanged, () => this.redraw());
    this.redraw();
  }

  private redraw(): void {
    const { layout, selection } = this.map;
    const { target, route, targetIndex } = this.explorer;
    this.overlay.draw((g) => {
      g.clear();
      const room = layout?.regions[targetIndex];
      if (room)
        g.rect(
          room.x * TILE,
          room.y * TILE,
          room.width * TILE,
          room.height * TILE,
        ).stroke({ color: COLORS.route, width: 2 });
      const node = selection?.regions[targetIndex];
      if (node) {
        const p = catalogNodePositions(selection).get(node.id)!;
        g.circle(p.x, p.y, NODE_RADIUS + 8).stroke({
          color: COLORS.route,
          width: 2,
        });
      }
      if (target && !layout && !selection)
        g.circle(target.x, target.y, 5).stroke({
          color: COLORS.route,
          width: 2,
        });
      for (const point of route)
        g.circle(point.x, point.y, 1.5).fill(COLORS.route);
    });
  }
}

/** Draws the target and route above the map. */
export class RouteEntity extends Entity {
  setup(params: { map: MapState; explorer: Explorer }): void {
    this.add(new Transform());
    this.add(new GraphicsComponent({ layer: OVERLAY_LAYER }));
    this.add(new RouteView(params.map, params.explorer));
  }
}
