---
"@yagejs/core": minor
---

`Entity.scene` and `Entity.spawnChild` — cleaner entity composition.

**`Entity.scene` now throws when the entity is detached** (was: returned `Scene | null`). Inside lifecycle code (`setup`, component `onAdd` / `update`, event handlers on an attached entity) the scene is always non-null by construction, so the previous nullable return type forced noisy `!` / `?.` at every callsite. The throwing variant mirrors what `Component.scene` already did and removes that noise.

A new **`Entity.tryScene`** getter preserves the nullable return for the rare case where defensive null-awareness is genuinely needed (systems iterating a query result that may include entities mid-destroy, etc.). Migration for the handful of callsites that relied on the nullable return is a one-liner rename.

**`Entity.spawnChild(name, Class | Blueprint, params?)` collapses** the common two-step "spawn an entity in the scene, then parent it" dance into one call, mirroring `Scene.spawn`'s overload shape:

```ts
// Before
const body = this.scene.spawn(EnemyBody, { color: 0xff6b6b });
this.addChild("body", body);

// After
this.spawnChild("body", EnemyBody, { color: 0xff6b6b });
```

Returns the spawned child for chaining. Throws if the parent is detached (same policy as the new `scene` getter).
