---
"@yagejs/core": patch
"@yagejs/save": patch
---

Components on one entity can declare the order their `update()` / `fixedUpdate()` run in.

- `Component.updatePriority` (instance, writable at any time) and `static updatePriority` (class default, inherited by subclasses). `ComponentUpdateSystem` calls an entity's components in ascending priority; equal priorities keep add order. Undeclared = 0, so add order is the order until a component sets a value; a negative value runs before undeclared siblings, a positive one after them.
- Zero cost when unused: an entity iterates its component map as before until one of its components leaves priority 0, then keeps a sorted array that is rebuilt only when a component is added, removed, or has its priority written. One difference between the two paths: a component that a sibling adds during an update pass can run in that same pass on the map path, and first runs next frame on the sorted path.
- `ComponentUpdateSystem` calls only components that are `effectiveEnabled`. Two mid-pass cases change as a result: a component that a sibling removed earlier in the pass is not called after its teardown, and when a component deactivates its own entity (`setActive(false)`), the siblings still to run in that pass are skipped — their `onDisable` has already fired.
- The Inspector's reflected component state includes `updatePriority` when it is not 0.
- Snapshots persist a per-instance `updatePriority` that differs from the class default (`ComponentSnapshot.updatePriority`) and re-apply it on load.
