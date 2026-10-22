# @yagejs-addons/procedural

Seeded, headless map generation in integer tiles.

- `RegionGraphGenerator(requirements, options)` → `RegionGraph`: a tree with
  named regions, kind counts, forbidden neighbours, a degree limit and keys.
- `CatalogGenerator(definition, options)` → `CatalogSelection`: a template,
  variant and connection slots per region of a supplied graph. Nothing placed.
- `RoomGenerator(definition, options)` → `RoomLayout`: the same selection plus
  room positions and exact openings.
- `CaveGenerator(options)` → `TileMap`: a connected cellular cave.

`@yagejs/core` is the only required peer. `/navigation` needs
`@yagejs/pathfinding`; `/level` needs `@yagejs/level`. No renderer or plugin.

## Dungeon from requirements

```ts
import {
  RegionGraphGenerator,
  RoomGenerator,
  type RoomDefinition,
} from "@yagejs-addons/procedural";

const graphJob = new RegionGraphGenerator(
  {
    start: { id: "start", kind: "entrance" },
    required: [
      { id: "treasure-a", kind: "treasure", grants: ["key-a"] },
      { id: "treasure-b", kind: "treasure", grants: ["key-b"] },
      { id: "boss", kind: "boss", requires: ["key-a", "key-b"] },
    ],
    counts: [
      { kind: "shop", min: 1 },
      { kind: "forge", min: 1 },
    ],
    minRegions: 15,
    fillKind: "encounter",
    forbiddenConnections: [["shop", "forge"]],
    maxConnections: 3,
  },
  { seed: 42 },
);
const graph = graphJob.generate();
if (!graph) throw new Error(graphJob.status);

const definition: RoomDefinition = {
  graph,
  templates: [
    {
      id: "hall",
      kinds: ["entrance", "encounter", "shop", "forge", "treasure", "boss"],
      size: { width: 5, height: 5 },
      connections: [
        { id: "n", side: "north", offset: { min: 1, max: 3 } },
        { id: "e", side: "east", offset: { min: 1, max: 3 } },
        { id: "s", side: "south", offset: { min: 1, max: 3 } },
        { id: "w", side: "west", offset: { min: 1, max: 3 } },
      ],
    },
  ],
};
const job = new RoomGenerator(definition, { seed: 42, maxSteps: 200_000 });
const layout = job.generate();
console.log(layout ?? job.inspect());
```

## Region graphs

`Region`: `{ id, kind, grants?: string[], requires?: string[] }`.
`RegionConnection`: `{ id, from, to, requires?: string[] }`, undirected.
`RegionGraph`: `{ start, regions, connections }`. Keys are permanent and
reusable. Entering a region collects its `grants`. Entering a region or
crossing a connection needs every key it `requires`. Cycles and parallel
connections are legal.

`RegionRequirements`:

- `start: Region`, `required?: Region[]`: named regions, always present. The
  start region cannot require keys.
- `counts?: { kind, min, max? }[]`: the generator creates `min` regions of the
  kind, or a seeded number in `[min, max]` when `max` is set. Named regions
  count. An omitted `max` sets no upper limit.
- `minRegions`, `fillKind`: `fillKind` regions are added until the graph has
  `minRegions` regions. A `fillKind` count's `max` caps them; see below for
  when that throws.
- `forbiddenConnections?: [kind, kind][]`: unordered pairs that never connect.
- `maxConnections?`: most neighbours per region, default 4.

Generated graphs are trees. A region that requires keys joins only after the
regions that grant them, so every region is reachable. Generated ids are
`<kind>:<n>`. Constructors throw for duplicate names, unknown keys, a `max`
below the named regions, non-integer counts, and a `fillKind` `max` that no
count draw can keep within `minRegions`. With a count range, a search that
fails draws new counts, so impossible ranged requirements end
`budget-exceeded`; only fixed counts can end `exhausted`.

`validateRegionGraph(graph, { keys?, collectKeys? }): readonly string[]`
reports duplicate ids, unknown endpoints, self-connections, keys that neither
a region nor `keys` provides, and regions that key collection never reaches.
`inspectProgression(graph, { keys?, collectKeys? })` returns
`{ reachable, keys, unreachable }`. `collectKeys` defaults to true; set it
false to test a fixed key set. It throws for a malformed graph.
Catalog and room generators check only graph structure (ids and endpoints),
not progression; validate an authored graph's progression yourself.

## Catalogs and variants

`CatalogDefinition`: `{ graph, templates: CatalogTemplate[], rules? }`.
`CatalogTemplate`: `{ id, kinds, connections: CatalogPort[], metadata?, tags?, weight?, variants? }`.
`CatalogPort`: `{ id, socket?, capacity? }`. Socket defaults to `"passage"`,
capacity to 1 link. Linked slots need the same socket.

A region selects a template whose `kinds` contains its kind. With `variants`,
exactly one variant is selected and the template itself is not a candidate.
`CatalogVariant`: `{ id, weight?, metadata?, tags?, regionIds?, kinds?, connections? }`.
Variant metadata shallowly overrides template metadata; tags are added;
`connections` replaces the whole list; `regionIds` and `kinds` restrict where
the variant applies.

`metadata` is `CatalogMetadata`: JSON data the game interprets. The addon
copies it into results and never reads it.

`CatalogRules` are hard constraints:

- `counts: { match, min?, max? }[]`: selected regions matching `match`, at
  least `min` (default 0) and at most `max` (default no limit). Cap a
  template's uses across its variants with `{ match: { templateId }, max }`.
- `regions: { regionId, match }[]`: the region selects only matching candidates.
- `forbiddenConnections: { from, to }[]`: no direct connection, either direction.

`CatalogSelector`: `{ kind?, templateId?, variantId?, tags? }`. Every given
field matches; `tags` needs all listed tags; `{}` matches everything. Variant
ids are local to a template.

Weights are finite and positive, default 1; template and variant weights
multiply. They order the seeded search, so heavier candidates are tried first.
They promise no frequency.

Constructors throw for duplicate template, variant or slot ids, a non-positive
weight or capacity, a rule or variant naming an unknown region, kind, template
or variant, and a region left with no eligible candidate.

```ts
import {
  CatalogGenerator,
  type CatalogDefinition,
} from "@yagejs-addons/procedural";

const market: CatalogDefinition = {
  graph: {
    start: "gate",
    regions: [
      { id: "gate", kind: "gate" },
      { id: "shop-a", kind: "shop" },
      { id: "shop-b", kind: "shop" },
      { id: "forge", kind: "forge" },
    ],
    connections: [
      { id: "a", from: "gate", to: "shop-a" },
      { id: "b", from: "gate", to: "shop-b" },
      { id: "c", from: "shop-a", to: "forge" },
    ],
  },
  templates: [
    { id: "gate", kinds: ["gate"], connections: [{ id: "exit", capacity: 2 }] },
    { id: "forge", kinds: ["forge"], connections: [{ id: "entrance" }] },
    {
      id: "shop",
      kinds: ["shop"],
      connections: [{ id: "entrance", capacity: 2 }],
      metadata: { music: "market" },
      variants: [
        {
          id: "weapons",
          weight: 4,
          tags: ["weapons"],
          metadata: { stock: "weapons" },
        },
        { id: "healing", tags: ["healing"], metadata: { stock: "potions" } },
      ],
    },
  ],
  rules: {
    counts: [{ match: { tags: ["healing"] }, min: 1, max: 1 }],
    forbiddenConnections: [
      { from: { tags: ["weapons"] }, to: { kind: "forge" } },
    ],
  },
};
const job = new CatalogGenerator(market, { seed: 42 });
const selection = job.generate();
if (selection)
  for (const region of selection.regions)
    console.log(region.id, region.variantId, region.metadata);
else console.log(job.inspect());
```

`CatalogSelection extends RegionGraph`: `start`, `regions: SelectedRegion[]`,
`connections: CatalogLink[]`, in the graph's order. `SelectedRegion` is the
`Region` plus `{ templateId, variantId, metadata, tags }`; `variantId` is null
for a template without variants. `CatalogLink` is the `RegionConnection` plus
`{ fromPort, toPort }`. The result is frozen.

## Rooms

`RoomDefinition`: a `CatalogDefinition` whose templates are `RoomTemplate`s.
`RoomTemplate` adds `size: { width, height }` (tiles, walls included, at
least 3), `connections: RoomConnectionArea[]`, `navigation?`, and
`variants?: RoomVariant[]`. `RoomVariant` may also replace `size`,
`connections` and `navigation`; `navigation: null` removes an inherited mask.

`RoomConnectionArea`: `{ id, side, offset: number | { min, max }, width?, socket?, capacity? }`.
`side` is `north | east | south | west`. `offset` is the zero-based boundary
column (north, south) or row (east, west) of the opening's first tile: one
position, or an inclusive range. `width` defaults to 1. Openings keep both
corner tiles closed. Two openings connect when they face each other with the
same width and socket. A room's selected openings never overlap; `capacity`
allows that many openings in one area.

`navigation` is rows of `#` and `.` matching `size`, `#` on the whole boundary,
with one connected floor that every permitted opening leads onto. Without a
mask, a room is walls on its boundary around an open floor.

`RoomGenerationOptions`: `GenerationOptions` plus `origin?` (start room's
top-left tile, default (0, 0)), `bounds?` (every footprint fits inside) and
`preferUniqueTemplates?` (try unplaced templates first, default true).

Rooms are rectangles placed by translation; author rotations as variants.
Rooms touch: each connection is a pair of openings on adjacent walls, so a
corridor is a corridor region in the graph. The search can retry another
variant when one does not fit. Every connection, cycles included, becomes a
pair of openings; a cycle the footprints cannot close makes the search fail.

`RoomLayout extends RegionGraph`: `start`, `regions: RoomPlacement[]`,
`connections: RoomConnection[]`, in the graph's order.
`RoomPlacement` is a `SelectedRegion` plus `{ x, y, width, height }` and the
selected `navigation`, when the template has one. `RoomConnection` is the
`RegionConnection` plus `{ fromOpening, toOpening }`, each a `RoomOpening`
`{ areaId, side, offset, width, socket }`. The layout is plain JSON and needs
nothing else to be read.

- `roomOpenings(layout, roomId): readonly RoomOpening[]`: one room's openings,
  for building its walls and doors.
- `isRoomLayoutWalkable(layout, tile, hasKey?)`: whether a point moving in
  four directions can stand on the tile. A locked room or connection is
  blocked unless `hasKey(key)` returns true for each key it requires; the
  default holds no keys. Non-integer tiles return false.

## Jobs

All generators take `{ seed, maxSteps? }`. `seed` is a uint32; `maxSteps` is
the operation budget, default 20,000.

- `step(operations = 256)`: advances at most that many operations.
- `generate()`: runs to a terminal status.
- `cancel()`: stops unfinished work.
- `status`: `running | succeeded | exhausted | budget-exceeded | cancelled`.
- `result`: frozen on `succeeded`, otherwise null. `steps`, `seed`.
- `inspect()`: `{ status, seed, steps, diagnostics }`. Catalog jobs add the
  partial `regions` and `connections`; room jobs add those plus `rejections`,
  a count per category: `socket`, `opening-used`, `alignment`, `overlap`,
  `bounds`, `catalog-rule`. Diagnostics keep one recent example per category.
  A `catalog-rule` diagnostic, from catalog or room jobs, names the broken
  count or forbidden-connection rule and the counts involved.

`exhausted` means every candidate was rejected: these inputs have no result.
`budget-exceeded` leaves that unknown; raise `maxSteps` or simplify the input.
Region graph, catalog and room searches restart in a new random order when
one attempt runs long, doubling the attempt length each time; the budget
diagnostic counts the restarts. Caves never restart.
Rules no selection can meet throw in the constructor: a count rule with `min`
above the regions with a matching candidate or `max` below the regions whose
every candidate matches, and a connection whose every template pair a
forbidden-connection rule rejects. A contradiction the search meets only after placing most
of the map usually ends `budget-exceeded`.
A valid graph can still be impossible to place with a given catalog or bounds.
Constructors validate and copy their inputs. Chunk size never changes the
result: the same inputs and seed give the same result.

`GenerationController<T extends GenerationJob>` runs a job on its host entity,
`operationsPerUpdate` (default 256) per component update. Disabling it,
deactivating the entity or pausing the scene pauses the job; removing it or
exiting the scene cancels an unfinished job. `ProceduralGenerationFinishedEvent`
(`{ status }`) is emitted once on the host, on the first update that sees a
terminal status. `controller.generator` is the job; the `generation` getter
returns `inspect()` for the Inspector.

```ts
import { Component, Entity, Scene } from "@yagejs/core";
import {
  CaveGenerator,
  GenerationController,
  ProceduralGenerationFinishedEvent,
} from "@yagejs-addons/procedural";

class GenerateCave extends Component {
  onAdd(): void {
    const job = new CaveGenerator({ seed: 42, width: 48, height: 32 });
    this.listen(
      this.entity,
      ProceduralGenerationFinishedEvent,
      ({ status }) => {
        if (status === "succeeded") console.log(job.result);
      },
    );
    this.entity.add(new GenerationController(job, 256));
  }
}
class MapHost extends Entity {
  setup(): void {
    this.add(new GenerateCave());
  }
}
class MapScene extends Scene {
  readonly name = "map";
  onEnter(): void {
    this.spawn(MapHost);
  }
}
```

## Caves

`CaveOptions`: `GenerationOptions` plus `width`, `height` (at least 3),
`wallProbability?` (0–1, default 0.45), `iterations?` (smoothing passes,
default 4) and `origin?` (default (0, 0)). The result is a `TileMap`
`{ origin, cells: string[] }` of `#` and `.`. Only the largest connected floor
area is kept and the boundary is closed. When no floor survives, the centre
tile is the floor. Larger maps need a larger `maxSteps`.

## Navigation

```ts
import { CaveGenerator } from "@yagejs-addons/procedural";
import { createTileMapGraph } from "@yagejs-addons/procedural/navigation";

const map = new CaveGenerator({ seed: 42, width: 48, height: 32 }).generate();
if (map) {
  const graph = createTileMapGraph(map, { tileWidth: 16, tileHeight: 16 });
  const row = map.cells.findIndex((cells) => cells.includes("."));
  const start = graph.cellToWorld(map.cells[row]!.indexOf("."), row);
  const end = graph.cellToWorld(map.cells[row]!.lastIndexOf("."), row);
  console.log(graph.findPath(start, end));
}
```

- `createRoomLayoutGraph(layout, { tileWidth, tileHeight, hasKey? }): GridGraph`
  uses the rules of `isRoomLayoutWalkable`. It calls `hasKey` during every
  `findPath`, so a key the game collects opens its locks without a rebuild.
- `createTileMapGraph(map, { tileWidth, tileHeight }): GridGraph` reads any
  `TileMap` with equal-length rows of `#` and `.`.

Both return a four-direction `GridGraph` with diagonals off; queries and
waypoints are world pixels. `tileWidth` and `tileHeight` are the game's
world-pixel tile size. Navigation describes a point: it does not read
colliders, player size, jumps or moving obstacles. Keep the game's collision
and doors consistent with the layout.

## Authored content

```ts
import type { Scene } from "@yagejs/core";
import type { LevelInstance, PreparedLevel } from "@yagejs/level";
import type { RoomLayout, RoomPlacement } from "@yagejs-addons/procedural";

declare function instantiateRoomLayout(
  scene: Scene,
  layout: RoomLayout,
  options: {
    readonly levelFor: (room: RoomPlacement) => PreparedLevel | undefined;
    readonly namespace: string;
    readonly tileWidth: number;
    readonly tileHeight: number;
  },
): readonly LevelInstance[];
```

From `@yagejs-addons/procedural/level`. Loads `levelFor(room)` for every room
at `room.x * tileWidth, room.y * tileHeight`, with namespace
`<namespace>:<index>`; pick by `room.templateId`, `room.variantId` or
metadata. Returns one `LevelInstance` per room, in layout order; the game
disposes them. Needs `@yagejs/level` 0.12.1 or later. It throws before
loading anything when `levelFor` returns no level, a prepared level has
diagnostics, the namespace is empty or contains `/`, a room's scene key (from
`levelSceneKeys` in `@yagejs/level`) is already taken, or a tile size is not
positive. Any failure while a room loads (entity `setup`, parameter decoding,
a key an earlier room's entity spawned) throws `RoomLayoutLoadError` with
`roomId`, `cause` and the `instances` already loaded, which stay in the scene.
Walls, doors and locks are game code.

## Saving

Store a `RoomLayout`, `CatalogSelection`, `RegionGraph` or `TileMap` as JSON
in an explicit save root. Before using one loaded from a save, check it:
`validateRoomLayout(definition, layout)` and
`validateCatalogSelection(definition, selection)` return errors when the saved
data no longer matches the current definition: graph, templates, variants,
resolved metadata, rules, slots, capacities, footprints and openings. They
throw for an invalid definition. A running job cannot be saved; keys and
entity state are the game's to save. The same inputs, input order, seed and
addon version reproduce a result.
