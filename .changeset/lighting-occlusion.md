---
"@yagejs/lighting": minor
---

Occluders block light, in the gameplay query and in the built-in overlay renderer.

- A light contributes to a point only when the straight line between them misses every enabled occluder. Touching an edge or a corner counts as blocked, an occluder containing a light does not block it, a point inside an occluder is dark for every light outside it, and shadows are hard. `LightingWorld.levelAt(x, y)` keeps its signature and answers by that rule, so a scene with occluders reads darker where a wall stands in the way.
- `OverlayLightingRenderer` draws each light through an inverse mask covering what its occluders hide, so the drawn picture and the query agree. The renderer redraws a light's shadows when the light, an occluder or the camera moves.
- `LightSource` takes `castShadows`, default `true`. Set it to `false` for a light that reaches through walls.
- `LightOccluder` follows the entity's world scale: a uniform positive scale resizes the shape, any other scale turns it into a scaled outline, matching how a physics collider follows entity scale. `LightOccluder.scale` reports it.
- `LightingWorld.levelGridInto(out, grid)` samples a rectangular grid of world points into a caller-owned `Float32Array`, row-major, one sample per cell centre, each equal to `levelAt` at that centre. Each source is summed only over the cells its radius reaches and against the occluders within that radius. The new `LightGrid` type describes the region.
- The overlay scales a light's drawn radius by the camera's effective zoom, so a zoom modifier moves the drawn light and its position together.
