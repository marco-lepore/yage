---
"@yagejs/pathfinding": patch
---

An engine peer range names the one engine minor the package was built and tested against.

- The optional `@yagejs/tilemap` peer range is `>=0.10.2 <0.11.0`. The tilemap adapter reads `TilemapData`, whose required fields have grown since the previous `>=0.8.0` floor, so the old window covered releases the adapter was never compiled against.
- A game holding pathfinding and tilemap on different minors now gets a version conflict from npm at install time. The peer stays optional, so grid pathfinding without a tilemap is unaffected.
