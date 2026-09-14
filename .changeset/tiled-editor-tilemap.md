---
"@yagejs/tilemap": patch
---

Support editing tilemaps in Tiled with automatic preview refresh.

Return cleanup completion for a map, its external tilesets and its counted images before the same map can reload.

Release images and parsed tilesets acquired by a failed map load so a corrected map reads fresh assets while preserving other owners' image references.
