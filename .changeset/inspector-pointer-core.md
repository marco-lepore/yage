---
"@yagejs/core": patch
---

Add `inspector.pointer`, pointer verbs that reach `@yagejs/ui` elements.

`inspector.input`'s pointer verbs write `InputManager` state and never reach a
UI primitive, which receives clicks as renderer events on its own container.
The new namespace dispatches real DOM pointer events at the canvas, so the
renderer hit-tests and delivers them the way it does for a person clicking.
Stacking order, a disabled button's pointer mode, clipping and the
auto-consume marking all apply.

```ts
const surface = inspector.snapshot().scenes[0]?.ui?.root;
const hit = inspector.pointer.click(surface.children[0].id); // or { x, y }
hit.path.some((node) => node.type === "UIButton"); // true
```

`click`, `down`, `up` and `move` dispatch; `hitTest` resolves and reports
without dispatching. A target is a `UINodeSnapshot.id`, aimed at the centre of
that node's `bounds`, or a virtual-space point. The returned hit carries
`nodeId` and `type` for the innermost node, `path` for the whole chain
innermost-first, the `point` used, and `consumed`.

The verbs need `RendererPlugin` and one rendered frame, and throw with an
authored message otherwise. `RendererAdapter` gains three optional members for
them: `virtualToCanvas`, `hitTestUIPath` and `hasRenderedFrame`.

A button's `onClick` has already run when a call returns, because delivery is
synchronous. Engine input state reflects the press one frame later.
