# @yagejs-addons/procedural

Headless seeded generation: `RegionGraphGenerator` for requirements,
`CatalogGenerator` for entry/variant selection without placement,
`RoomGenerator` for catalog layout, `CaveGenerator` for cellular maps.
Core is the only required peer. `/navigation` requires pathfinding;
`/level` requires level. No renderer or plugin required.

## Requirements and catalog

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
      { kind: "treasure", min: 2 },
      { kind: "boss", min: 1 },
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
  id: "ruins",
  revision: "1",
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
      navigation: ["#####", "#...#", "#...#", "#...#", "#####"],
    },
  ],
};
const generator = new RoomGenerator(definition, {
  seed: 42,
  maxSteps: 200_000,
});
const layout = generator.generate();
console.log(layout ?? generator.inspect());
```

`RegionRequirements`:

- `start: Region`, `required?: Region[]` name specific regions.
- `counts?: { kind, min, max? }[]` includes named regions; max defaults to min.
- `minRegions`, `fillKind` add filler without exceeding kind maxima.
- `forbiddenConnections?: [kind, kind][]` forbids direct undirected connections.
- `maxConnections?: number` defaults to 4. Generated graphs are trees.

`RegionGraph`: `{ start, regions: Region[], connections: RegionConnection[] }`.
Region: `{ id, kind, grants?: string[], requires?: string[] }`.
Connection: `{ id, from, to, requires?: string[] }`. Undirected; all required
keys must be held. Keys are permanent and reusable. Reaching a region grants
its keys. Counts/adjacency are constraints of graph generation; arbitrary
provided graphs must encode their intended structure themselves.

`validateRegionGraph(graph): readonly string[]` checks structure and progression.
`inspectProgression(graph, keys = [], collectKeys = true)` returns
`{ reachable, keys, unreachable }`. Set collectKeys false to query a fixed
inventory. Cycles are legal. Unknown key grants, duplicate ids, unknown
endpoints, disconnected regions and circular key requirements are rejected.

`RoomDefinition`: `{ id, revision, graph, templates, maxUses?, rules? }`.
`RoomTemplate`: `{ id, kinds, size: {width,height}, connections, navigation? }`.
Each region uses a template whose kinds includes its kind. Footprints are
rectangles in integer tiles, including walls. Translations only; author
rotated variants separately. Cycles are supported when spatially feasible.

Connection area: `{ id, side, offset: number | {min,max}, width?, socket?, capacity? }`.
Sides: north/east/south/west. Offset is the zero-based boundary column for
north/south or row for east/west. Ranges include both endpoints. Width defaults
to 1, socket to passage. Openings must leave corners closed. Selected openings
must face opposite ways with equal width/socket and cannot overlap each other.
Capacity defaults to one link per area; larger capacities permit distinct openings.

Navigation is optional. A supplied mask uses #/. and must match size, have
closed boundaries and a connected interior floor. Every candidate opening
must lead into floor. Selected openings are carved by navigation queries.
Without masks, layout generation validates placement and graph progression;
walkability is not assumed. `validation.connectedWalkableCells` is null when
any placed template lacks a mask, otherwise true with all keys assumed held.

Result: `RoomLayout` contains generatorVersion 4, definition identity/revision,
resolved options, rooms `{id,templateId,variantId,metadata,tags,x,y,width,height}`, connections
`{id,from,to,fromOpening,toOpening}`, diagnostics and validation claims.
An opening contains `{areaId,side,offset,width,socket}`.
`roomOpenings(layout, roomId)` derives selected openings for one room.
Game code builds walls/colliders and operates gates using these results.

## Data catalogs and constrained variants

`new CatalogGenerator(definition: CatalogDefinition, options: GenerationOptions)`
selects entries, variants and connection slots for a supplied graph. No size,
opening coordinates or navigation required. Graph edges are preserved, including
cycles. This makes no spatial or walkability claim.

```ts
import {
  CatalogGenerator,
  resolveCatalogEntry,
  type CatalogDefinition,
} from "@yagejs-addons/procedural";

const catalog: CatalogDefinition = {
  id: "market",
  revision: "1",
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
        {
          id: "healing",
          weight: 1,
          tags: ["healing"],
          metadata: { stock: "potions" },
        },
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
const job = new CatalogGenerator(catalog, { seed: 42 });
const selection = job.generate();
if (selection) {
  for (const region of selection.regions) {
    const entry = resolveCatalogEntry(catalog, region);
    console.log(region.id, entry.variantId, entry.metadata, entry.connections);
  }
  console.log(selection.connections);
} else console.log(job.inspect());
```

`CatalogDefinition`: `{id,revision,graph,templates:CatalogEntry[],maxUses?,rules?}`.
`CatalogEntry`: `{id,kinds,connections,metadata?,tags?,weight?,variants?,size?,navigation?}`.
Connection: `{id,socket?,capacity?}`. Socket defaults to passage, capacity to 1
(range 1–64). Links match sockets and respect capacities. Optional size alone
is valid data: dimensions 1–1,000,000 integer tiles. Spatial connection areas
also accepted, but their sides/offsets do not constrain abstract placement.

Variant: `{id,weight?,metadata?,tags?,regionIds?,kinds?,connections?,size?,navigation?}`.
Metadata shallowly overrides base keys; tags are unioned. RegionIds/kinds filter
eligibility. Connections replace the whole list, size replaces both dimensions,
navigation replaces the mask; null removes an inherited mask. Omitted fields
inherit. Supplied variants are exhaustive alternatives; base is not selectable.
No variants means variantId null. Up to 64 variants per entry.

Metadata uses `CatalogMetadata` / recursive `CatalogValue`: plain JSON objects,
arrays, strings, finite numbers, booleans and null; no callbacks, accessors or
classes. Each metadata object has at most 10,000 values and depth 32. The game
interprets data. It does not change region key grants/requirements.

`CatalogRules` (each list at most 256 entries):

- counts: `{match,min,max?}[]`; max defaults 64, unlike RegionRequirements counts.
- regions: `{regionId,match}[]` restricts a named region.
- forbiddenConnections: `{from:match,to:match}[]` forbids either edge direction.
  Selector: `{kind?,templateId?,variantId?,tags?}`; all fields/tags must match.
  Empty selector matches all. Variant ids are local; pair with templateId to
  identify one entry's variant. maxUses counts an entry across all variants.

Entry and variant weights default to 1, multiply, and must be finite/positive
(up to 1,000,000 each; underflowed products rejected). Weighted search order is
seeded. Hard constraints outrank preference. Output frequencies are not promised.

`CatalogSelection`: generatorVersion 1, definitionId, definitionRevision,
options `{seed,maxSteps}`, regions `{id,templateId,variantId,metadata,tags}`,
connections `{id,from,to,fromPort,toPort}`. Copied/frozen results.
`resolveCatalogEntry(definition,assignment): ResolvedCatalogEntry` resolves
merged data, connections and optional size/navigation; use validated selections.
`validateCatalogSelection(definition,selection)` checks identity, rules, metadata,
ports, sockets and capacities. `inspect()` adds selectedRegions/connections.
`snapshot()` / static `restore()` use version 1 and validate without regeneration.

RoomDefinition is a stricter CatalogDefinition with spatial base RoomTemplates.
RoomGenerator also accepts CatalogDefinition when variants supply complete
spatial data. It uses the same variants/rules during placement and backtracks spatially invalid
choices. Every eligible candidate needs size and spatial connection areas.
`resolveRoomTemplate(definition,room)` returns the selected variant's spatial
template. Masks stay optional. Results contain variantId/metadata/tags. The
level adapter still looks up content by templateId; the game applies metadata.

## Jobs, limits and component lifetime

All jobs accept `{seed, maxSteps?}`. Seed is uint32; maxSteps defaults to 20,000,
range 1–10,000,000. `step(n=256)` advances bounded operations, `generate()` runs
to termination, `cancel()` stops unfinished work. `result` is immutable on
success, null otherwise. Config is copied. Frame chunk size does not affect
results; budgets are not a wall-clock guarantee. Constructors validate eagerly.

Status: running | succeeded | exhausted | budget-exceeded | cancelled.
Exhausted rejects all supported candidates for these inputs; budget-exceeded
leaves feasibility unknown. Terminal jobs do no more work. No partial result
is published. Use a new job to retry.

Room options: `origin?` defaults to (0,0); `bounds?` contains every footprint;
`preferUniqueTemplates?` defaults true and tries unused templates first.
No optimality/uniqueness guarantee. `maxUses` is a hard per-template cap.
Limits: 64 regions, 256 graph connections, 128 templates, template dimensions
3–64, up to 64 connection areas per template. Room origin/bounds coordinates
are within ±1,000,000 tiles; bounds extents are positive and at most 1,000,000.

`inspect()` returns status, steps and diagnostics. Room inspection adds
options, placements, connections, rejection counts and validation. Rejections
retain one recent example per category: socket, opening-used, alignment,
overlap, bounds, catalog-rule. Rejected candidates do not imply overall failure.

```ts
import { Component, Entity, Scene } from "@yagejs/core";
import {
  CaveGenerator,
  GenerationController,
  GenerationFinishedEvent,
} from "@yagejs-addons/procedural";

class GenerateCave extends Component {
  onAdd(): void {
    const job = new CaveGenerator({ seed: 42, width: 48, height: 32 });
    this.listen(this.entity, GenerationFinishedEvent, ({ status }) => {
      if (status === "succeeded") console.log(job.result);
    });
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

`GenerationController<T extends GenerationJob>` exposes generator and
`generation` inspection. Custom jobs implement status/step/inspect/cancel.
Disable/inactive entity/scene pause suspends updates. Removal/scene exit
cancels. `GenerationFinishedEvent` fires once on the first update observing a
terminal status; removal emits no teardown event. Inspector reads
`getComponentData(host, "GenerationController")`.

## Caves and tile maps

```ts
import { CaveGenerator } from "@yagejs-addons/procedural";
import { createTileMapGraph } from "@yagejs-addons/procedural/navigation";
const cave = new CaveGenerator({ seed: 42, width: 48, height: 32 });
const map = cave.generate();
if (map) createTileMapGraph(map, { tileWidth: 16, tileHeight: 16 });
```

Cave options: width/height 3–256; wallProbability 0–1 default 0.45; iterations
0–16 default 4. Returns `TileMap { origin: {x,y}, cells: string[] }` with #/.
Cells undergo smoothing; only the largest connected floor area is retained.
The boundary is closed; empty output gets one central floor tile. Larger maps
may exceed the default operation budget. No catalog or region graph required.

## Navigation and authored content

Adapter signatures (the [guide](https://yage.dev/addons/procedural/#load-authored-content-and-save-layouts)
shows catalog preparation and component ownership):

```ts
import type { Scene } from "@yagejs/core";
import type { LevelInstance, PreparedLevel } from "@yagejs/level";
import type { GridGraph } from "@yagejs/pathfinding";
import type {
  CatalogDefinition,
  RoomLayout,
  TileScale,
} from "@yagejs-addons/procedural";

declare function instantiateRoomLayout(
  scene: Scene,
  definition: CatalogDefinition,
  layout: RoomLayout,
  levels: Readonly<Record<string, PreparedLevel>>,
  namespace: string,
  scale: TileScale,
): readonly LevelInstance[];
declare function createRoomLayoutGraph(
  definition: CatalogDefinition,
  layout: RoomLayout,
  scale: TileScale,
  options?: { readonly keys?: readonly string[]; readonly maxCells?: number },
): GridGraph;
```

`isRoomLayoutWalkable(definition,layout,point,keys=[])` uses integer tiles.
`createRoomLayoutGraph(definition,layout,scale,{keys?,maxCells?}={})` requires
masks for every placed template. Unmet region/connection requirements block
passage. No automatic key collection. Rebuild the static graph after keys change.
`createTileMapGraph(map,scale,maxCells=1_000_000)` requires only a rectangular
#/. mask. Both return four-direction GridGraph; queries/waypoints use pixels.
MaxCells 1–10,000,000. TileScale dimensions are integers 1–1,000,000 pixels.
Map/scale changes after construction do not alter the navigation snapshot.

The masks describe a point moving orthogonally. Player radius, collisions,
platformer reachability, one-way doors, consumable keys, moving obstacles and
WFC rules are not inferred. Keep game collision/lock behavior consistent.

Level loading uses prepared LevelDocuments keyed by template id. Preload
levelAssets normally. Room offsets multiply by TileScale; content does not
resize. Namespaces are prefix:index, prefix non-empty without / and unique in
scene. The layout, prepared documents and all planned scene keys are checked
before any room loads. An occupied key throws naming that key without loading
rooms. Returns LevelInstance handles for game-owned disposal. A setup error
stops further loads; RoomLayoutLoadError carries roomId/cause/earlier successful
instances. Those instances remain. Loader does not create walls or operate locks.

## Persistence

RoomGenerator.snapshot()/restore() covers a completed definition and layout,
version 4. Older snapshots rejected. Restore validates graph, geometry, opening
alignment, bounds, caps and validation claims without rerunning generation.
`validateRoomLayout(definition, layout)` returns layout errors; malformed
input definition/options throw. A snapshot embeds its definition; validate
against current content or migrate when it changes.

Store snapshots, RegionGraph results or TileMap results in an explicit save
root. Active jobs cannot be saved/resumed. Runtime keys/entity state belong to
the game. Reproduction requires identical inputs, ordering, seed, options and
algorithm version. Increment definition.revision when graph/catalog changes.
