---
"@yagejs/renderer": patch
---

Report what the user-interface hit test found, not only whether it claimed the
pointer.

`hitTestUIPath(x, y)` returns the hit container and its ancestors, innermost
first, plus whether the chain crosses a pointer-consume surface. A caller that
needs to name the element under a point — matching it against an Inspector
snapshot, for one — reads the chain; `hitTestUI(x, y)` keeps its boolean
answer for callers that only need the claim.

`hasRenderedFrame()` reports whether a frame has been drawn. Pointer delivery
needs one: the event boundary roots its hit test at the last object rendered
and drops an event when there is none.
