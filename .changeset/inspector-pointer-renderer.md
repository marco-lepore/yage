---
"@yagejs/renderer": patch
---

Deliver pointer events and report what the user-interface hit test found.

`dispatchPointerEvent(type, point, button?)` sends a press, a release or a
move at a virtual-space point through Pixi's own event system, so a
`@yagejs/ui` button runs its `onClick` and stacking order, a disabled button's
pointer mode and clipping all apply. The event goes to the canvas and bubbles,
so `@yagejs/input` receives it too and applies it at the next drain. A move
carries whichever buttons an earlier press left held. Throws when no frame has
been drawn yet: the event boundary hit-tests against the last object rendered
and drops every event until one exists.

`hitTestUIPath(x, y)` returns the hit container and its ancestors, innermost
first, plus whether the chain crosses a pointer-consume surface. A caller that
needs to name the element under a point — matching it against an Inspector
snapshot, for one — reads the chain; `hitTestUI(x, y)` keeps its boolean
answer for callers that only need the claim.

`hasRenderedFrame()` reports whether a frame has been drawn.
