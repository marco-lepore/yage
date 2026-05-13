---
"@yagejs/core": minor
"@yagejs/physics": minor
"@yagejs/renderer": minor
---

Dev-mode warnings for common silent-failure modes:

- `Component.use(Key)` now throws a named error when called at field-init
  time (before the component is bound to an entity), pointing at
  `this.service(Key)` as the lazy alternative.
- `ColliderComponent.onCollision` on a sensor collider (or `onTrigger` on a
  non-sensor) emits a one-shot dev warning.
- Asymmetric collision-mask pairs (where Rapier silently drops events) emit
  a one-shot dev warning per `(layers, mask)` tuple.
- Declaring a scene layer named `"ui"` without `space: "screen"` warns that
  the auto-provisioned UI layer is being shadowed by a world-space layer.
- A polygon collider whose convex hull drops vertices (concave input) warns
  so the developer can decompose or switch to a polyline.

All warnings gate on `process.env.NODE_ENV !== "production"` via a new
`isDev()` / `devWarn()` helper exported from `@yagejs/core` (`@internal`).
