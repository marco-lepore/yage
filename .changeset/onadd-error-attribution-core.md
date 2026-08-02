---
"@yagejs/core": patch
---

Attribute a throw from `onAdd()` to the component that threw

- `Entity.add()` runs `onAdd()` through `ErrorBoundary`, so a component that reports a missing dependency is named in the log and recorded in `Inspector.getErrors().callbackErrors`. The error is rethrown unchanged, so where it ends up is the same as before. Previously `onAdd()` was the one component lifecycle hook with no boundary around it, and its failure was attributed to whatever outer call it escaped into — a `Scene onEnter hook` for a component added during scene setup, for instance.
- Missing plugin registrations surface this way: `RigidBodyComponent` without `PhysicsPlugin`, a `SpriteComponent` without a renderer, a UI component on an undeclared layer.
