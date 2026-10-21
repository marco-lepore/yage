import { Component, Entity, RandomKey, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import { InputManagerKey } from "@yagejs/input";
import type { GridGraph } from "@yagejs/pathfinding";
import { isRoomLayoutWalkable } from "@yagejs-addons/procedural";
import type {
  RoomLayout,
  RoomPlacement,
  TileMap,
  TilePoint,
} from "@yagejs-addons/procedural";
import {
  createRoomLayoutGraph,
  createTileMapGraph,
} from "@yagejs-addons/procedural/navigation";
import {
  COLORS,
  MapChanged,
  OVERLAY_LAYER,
  RouteChanged,
  TILE,
  TILE_SCALE,
  WALK_SPEED,
} from "./constants.js";
import type { MapState } from "./map.js";

const STEPS = [
  ["left", -1, 0],
  ["right", 1, 0],
  ["up", 0, -1],
  ["down", 0, 1],
] as const;

/** World-pixel centre of a tile. */
function tileCentre(tile: TilePoint): Vec2 {
  return new Vec2((tile.x + 0.5) * TILE, (tile.y + 0.5) * TILE);
}
/** The room's floor tile nearest its centre, ignoring locks. */
function standTile(layout: RoomLayout, room: RoomPlacement): TilePoint {
  const cx = room.x + (room.width - 1) / 2,
    cy = room.y + (room.height - 1) / 2;
  let best: TilePoint = { x: room.x + 1, y: room.y + 1 },
    bestDistance = Infinity;
  for (let y = room.y + 1; y < room.y + room.height - 1; y++)
    for (let x = room.x + 1; x < room.x + room.width - 1; x++) {
      const distance = Math.abs(x - cx) + Math.abs(y - cy);
      if (
        distance < bestDistance &&
        isRoomLayoutWalkable(layout, { x, y }, () => true)
      ) {
        best = { x, y };
        bestDistance = distance;
      }
    }
  return best;
}
function caveFloor(cave: TileMap): TilePoint[] {
  return cave.cells.flatMap((row, y) =>
    [...row].flatMap((cell, x) =>
      cell === "." ? [{ x: cave.origin.x + x, y: cave.origin.y + y }] : [],
    ),
  );
}

// ---------------------------------------------------------------------------
// Explorer — walks the generated map
// ---------------------------------------------------------------------------

/**
 * Tab picks a target, Space walks the route there, the arrow keys step one
 * tile. Entering a room hands it to `MapState.enter`, which collects its
 * keys. One navigation graph serves the whole run: it asks the map's
 * `hasKey` during every path search, so a collected key opens the boss
 * room without a rebuild.
 */
export class Explorer extends Component {
  static override readonly inspectExclude = [
    "transform",
    "marker",
    "input",
    "random",
    "map",
    "graph",
    "path",
  ];
  private readonly transform = this.sibling(Transform);
  private readonly marker = this.sibling(GraphicsComponent);
  private readonly input = this.service(InputManagerKey);
  private readonly random = this.service(RandomKey);
  private graph: GridGraph | undefined;
  private path: Vec2[] = [];
  /** Index into the map's regions; also the selected node on the catalog map. */
  targetIndex = 0;
  /** Where Space walks to, in world pixels. */
  target: Vec2 | null = null;
  /** The last walk request found no route. */
  blocked = false;

  constructor(private readonly map: MapState) {
    super();
  }

  /** Waypoints still ahead, in world pixels. */
  get route(): readonly Vec2[] {
    return this.path;
  }
  get walking(): boolean {
    return this.path.length > 0;
  }
  get currentRoom(): RoomPlacement | undefined {
    const tile = this.tile();
    return this.map.layout?.regions.find(
      (room) =>
        tile.x >= room.x &&
        tile.y >= room.y &&
        tile.x < room.x + room.width &&
        tile.y < room.y + room.height,
    );
  }
  get targetRoom(): string | null {
    const regions = this.map.layout?.regions ?? this.map.selection?.regions;
    return regions?.[this.targetIndex]?.id ?? null;
  }
  /** Where the explorer is and where it is going. Tests read it through the Inspector. */
  get exploration(): {
    currentRoom: string | null;
    targetRoom: string | null;
    walking: boolean;
    blocked: boolean;
    routeLength: number;
    /** The explorer stands on the target's tile centre. */
    atTarget: boolean;
  } {
    const { x, y } = this.transform.position;
    return {
      currentRoom: this.currentRoom?.id ?? null,
      targetRoom: this.targetRoom,
      walking: this.walking,
      blocked: this.blocked,
      routeLength: this.path.length,
      atTarget:
        this.target !== null && this.target.x === x && this.target.y === y,
    };
  }

  onAdd(): void {
    this.listen(this.map.entity, MapChanged, () => this.reset());
    this.reset();
  }

  update(dt: number): void {
    if (this.input.isJustPressed("select")) this.selectNext();
    if (!this.graph) return;
    if (this.input.isJustPressed("walk")) this.walk();
    if (this.walking) this.advance(dt);
    else
      for (const [action, dx, dy] of STEPS)
        if (this.input.isJustPressed(action, { repeat: true })) {
          const tile = this.tile();
          this.stepTo({ x: tile.x + dx, y: tile.y + dy });
        }
  }

  private reset(): void {
    const { layout, cave } = this.map;
    this.path = [];
    this.blocked = false;
    this.targetIndex = 0;
    this.graph = layout
      ? createRoomLayoutGraph(layout, {
          ...TILE_SCALE,
          hasKey: this.map.hasKey,
        })
      : cave
        ? createTileMapGraph(cave, TILE_SCALE)
        : undefined;
    this.marker.visible = this.graph !== undefined;
    const start = layout
      ? standTile(layout, layout.regions.find((r) => r.id === layout.start)!)
      : cave
        ? caveFloor(cave)[0]!
        : { x: 0, y: 0 };
    const position = tileCentre(start);
    this.transform.setPosition(position.x, position.y);
    this.chooseTarget();
    this.arrive();
  }

  private selectNext(): void {
    const regions = this.map.layout?.regions ?? this.map.selection?.regions;
    if (regions) this.targetIndex = (this.targetIndex + 1) % regions.length;
    this.chooseTarget();
  }

  private chooseTarget(): void {
    const { layout, cave } = this.map;
    const room = layout?.regions[this.targetIndex];
    this.target = room
      ? tileCentre(standTile(layout!, room))
      : cave
        ? tileCentre(this.random.pick(caveFloor(cave)))
        : null;
    this.blocked = false;
    this.entity.emit(RouteChanged);
  }

  private walk(): void {
    if (!this.target) return;
    const found = this.graph!.findPath(this.transform.position, this.target);
    this.blocked = found === null;
    this.path = found ? found.waypoints.slice(1) : [];
    this.entity.emit(RouteChanged);
  }

  private advance(dt: number): void {
    const next = this.path[0]!;
    const position = Vec2.moveTowards(
      this.transform.position,
      next,
      WALK_SPEED * dt,
    );
    this.transform.setPosition(position.x, position.y);
    if (position.x !== next.x || position.y !== next.y) return;
    this.path = this.path.slice(1);
    this.arrive();
    this.entity.emit(RouteChanged);
  }

  private stepTo(tile: TilePoint): void {
    const { layout, cave } = this.map;
    const open = layout
      ? isRoomLayoutWalkable(layout, tile, this.map.hasKey)
      : cave?.cells[tile.y - cave.origin.y]?.[tile.x - cave.origin.x] === ".";
    if (!open) return;
    const position = tileCentre(tile);
    this.transform.setPosition(position.x, position.y);
    this.arrive();
    this.entity.emit(RouteChanged);
  }

  private arrive(): void {
    const room = this.currentRoom;
    if (room) this.map.enter(room);
  }

  private tile(): TilePoint {
    const { x, y } = this.transform.position;
    return { x: Math.floor(x / TILE), y: Math.floor(y / TILE) };
  }
}

/** The player's marker. Hidden on the catalog map, which has no positions. */
export class ExplorerEntity extends Entity {
  explorer!: Explorer;
  setup(params: { map: MapState }): void {
    this.add(new Transform());
    this.add(
      new GraphicsComponent({ layer: OVERLAY_LAYER }).draw((g) => {
        g.circle(0, 0, 4).fill(COLORS.explorer);
      }),
    );
    this.explorer = this.add(new Explorer(params.map));
  }
}
