# @yagejs-addons/procedural

Generate region graphs from room counts, forbidden neighbours and key
requirements. Select data-only catalog entries and weighted metadata variants
under count, eligibility and neighbour rules. Assemble those graphs from catalog footprints and flexible
connection areas, or generate cellular caves without room templates.
All coordinates are integer tiles; engine adapters apply the game's pixel scale.

`RegionGraphGenerator`, `CatalogGenerator`, `RoomGenerator` and `CaveGenerator` run directly or
through `GenerationController` on a host entity. Each job has a seed,
operation budget, cancellation and inspection. Catalog navigation masks are
optional; walkability queries require them. Keys are reusable capabilities.
The game owns collision, rendering, key pickups and door behavior.

`/level` loads prepared YAGE level content. `/navigation` creates static
four-direction navigation for a room layout with supplied keys or a tile map.

See the [guide](https://yage.dev/addons/procedural/), the
[agent reference](docs/llms/procedural.md), and the
[interactive example](https://examples.yage.dev/procedural-rooms.html).
