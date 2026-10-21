# @yagejs-addons/procedural

Seeded map generation for YAGE, in integer tiles.

- `RegionGraphGenerator` turns requirements into a region graph: named
  regions, counts per kind, forbidden neighbours and key-locked regions.
- `RoomGenerator` places a room template for every region, with matching
  doors, under catalog rules and weighted variants.
- `CatalogGenerator` chooses templates and variants for a graph without
  placing anything.
- `CaveGenerator` builds a connected cellular cave.

Results are plain JSON that carry everything the game needs to draw,
navigate and load each room. `GenerationController` runs any generator on
an entity, a bounded amount of work per frame. Keys are permanent; the game
owns pickups, doors, collision and rendering.

`/navigation` builds pathfinding graphs for layouts and tile maps, reading the
game's keys during every path search. `/level` loads authored YAGE level
content into each room.

See the [guide](https://yage.dev/addons/procedural/), the
[agent reference](docs/llms/procedural.md), and the
[interactive example](https://examples.yage.dev/procedural-rooms.html).
