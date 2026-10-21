---
"@yagejs-addons/procedural": minor
---

Add seeded procedural map generation: region graphs from requirements, catalog room layouts, catalog selection without placement, and cellular caves.

- Generate region graphs with named regions, counts per kind, forbidden neighbours, a degree limit and permanent keys. Validate any graph's progression.
- Place room templates for every region with doors that match by side, width and socket. Doors can take a fixed position or any position in a range. Rooms without a navigation mask are walls around an open floor.
- Choose templates and weighted variants under count, per-region and connection rules, with or without placing rooms. Count rules that no selection can meet throw when the generator is created. Results carry each region's kind, keys, variant, metadata and tags.
- Return layouts as plain JSON that need no catalog to draw, navigate or load. Check saved layouts and selections against the current catalog.
- Run generation across frames with a component that pauses, cancels and reports to the Inspector. Diagnostics name the count or connection rule that rejected a candidate.
- Restart region graph, catalog and room searches in a new random order when one attempt runs long, so a single early choice cannot use up the budget. A finished attempt has tried every choice, so `exhausted` means the inputs have no result.
- Navigate layouts with a pathfinding graph that reads the game's keys during every path search, or navigate any tile map. Load authored level content into each room.
