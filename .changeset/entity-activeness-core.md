---
"@yagejs/core": minor
---

Entities can now be turned off and reused instead of destroyed and respawned: `entity.setActive(false)` puts an entity and its whole subtree to sleep, and components get `onEnable` / `onDisable` to release and reacquire live resources.

- `Entity` gains `activeSelf` (own bit), `isActive` (own bit and every ancestor's), and `setActive(active)`. Descendants follow their parent while keeping their own `activeSelf`.
- `Component` gains `onEnable()` / `onDisable()`, fired when `component.enabled && entity.isActive` changes, and `effectiveEnabled` to read that state. Order is `onAdd` → query join → `onEnable` on add, and `onDisable` → `onRemove` / `onDestroy` on teardown. A throwing hook is attributed to its component and rethrown, like a throwing `update()`.
- `Component.enabled` is an accessor rather than a plain field, so writing it fires the hooks. Deactivating an entity does not write per-component `enabled` flags — a component you disabled by hand stays disabled.
- Dormant entities leave every `QueryCache` query and are excluded from `scene.findEntity`, `scene.findEntitiesByTag`, `scene.findEntities`, and `filterEntities`. `scene.getEntities()` and `scene.findByKey` still return them.
- `ComponentUpdateSystem` and `ProcessSystem` skip dormant entities, so a dormant entity's components and processes pause rather than keep running. `QueryCache` gains `onEntityActivated` / `onEntityDeactivated`, and `EntityCallbacks` carries both.
- Both Inspector entity snapshot shapes gain an `active` field, component state reflection reports `enabled`, and camera lookup skips dormant entities. `getEntityByName`, `getEntityPosition`, `hasComponent`, and `getComponentData` resolve names through `scene.findEntity` and so read a dormant entity as absent — `getEntities()` is where its `active: false` entry shows up.
