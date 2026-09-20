---
"@yagejs/lighting": patch
---

A light has a size and can be narrowed into a spotlight.

- `LightSource` takes `size`, the lamp's diameter in world pixels, default `0`. A lamp wider than a point is partly hidden behind a blocker's edge, so a partly covered point is dimmed by the share of the lamp it can still see rather than switched off, and the shadow's border widens with the distance from the blocker. `light.size` reads and sets it.
- `LightingWorld.levelAt(x, y)` and `levelGridInto(out, grid)` scale each source's contribution by that share. The lamp is a line of width `size` centred on the light and square to the direction from the point to it; every occluder's outline is projected onto that line from the point, the projections are merged, and the unblocked share is what is left. At `size: 0` the share is 1 or 0 and the answer is the straight-line test. A wide lamp costs several times more to query, so keep `size` at `0` where a soft border is not wanted.
- `LightSource` takes `cone: { angle }`, the full spotlight spread in radians, aimed along the entity's world rotation. A cone limits where direct light lands, in the query as well as in the picture. `light.coneAngle` reads and sets it, and a whole turn is the default. `LightSource.rotation` reports the world rotation the cone points along.
- `OverlayLightingRenderer` draws a light with a cone as a pie slice turned by its entity.
- Shadow edges in the built-in overlay stay hard whatever a light's `size` says. At `size: 0` the picture is exactly what `levelAt()` reports; above it the drawn edge runs along the middle of the soft border the query answers with. The query is the truth whichever renderer a scene uses.
