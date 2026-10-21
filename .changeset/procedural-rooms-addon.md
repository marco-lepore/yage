---
"@yagejs-addons/procedural": minor
---

Add seeded procedural map generation with region requirements, catalog room assembly and cellular caves.

- Generate region graphs with room counts, forbidden neighbours and reusable key requirements. Validate progression independently of spatial layout.
- Select catalog entries and metadata variants independently of spatial placement. Enforce count, eligibility, connection-capacity and neighbour rules before weighted preferences. Preserve selected variants and resolved metadata in results and snapshots.
- Place catalog footprints around authored or generated graphs, including cycles. Select exact openings from fixed positions or wall ranges with matching widths and sockets. Retry variants during placement when their geometry does not fit. Connection areas default to one link; capacity permits additional distinct openings.
- Keep navigation masks optional and report when walkability has not been checked. Query locked routes using the game's collected keys, or navigate cave maps without room templates.
- Run bounded jobs through a shared component with cancellation and Inspector diagnostics. Save completed room layouts and load authored YAGE level content through an optional adapter.
- Use integer tile coordinates throughout generation and choose pixel dimensions separately in engine adapters.
- Reject occupied scene keys before loading any room content. Build navigation from resolved room masks and openings without repeating catalog resolution for each tile.
