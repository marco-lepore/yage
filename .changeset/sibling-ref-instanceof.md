---
"@yagejs/core": patch
---

A `this.sibling(Cls)` reference passes `instanceof Cls`, so an engine API that
checks the type of what it is handed accepts it. `camera.follow(this.transform)`
from a component that declared `transform = this.sibling(Transform)` read the
reference as a point with no `x`/`y`, set the camera position to `NaN`, and left
every world-space layer blank while screen-space layers and audio kept working.
The same check broke `ScreenFollow` given such a reference, and made
`feelAfterimage` reject a sprite held the same way. The check passes without
resolving the sibling, and the Inspector still skips such a field.
