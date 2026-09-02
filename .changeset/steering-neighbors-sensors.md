---
"@yagejs-addons/steering": patch
---

`physicsNeighbors` takes a `sensors` option, passed through to the radius query. Physics queries now skip sensor colliders by default, so a flock counts solid neighbours; pass `sensors: "include"` when the agents themselves carry sensor colliders.
