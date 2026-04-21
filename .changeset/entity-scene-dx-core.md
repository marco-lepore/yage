---
"@yagejs/core": minor
---

`Entity.scene` and `Entity.spawnChild` — cleaner entity composition.

**`Entity.scene` now throws when the entity is detached** (was: returned `Scene | null`). Inside lifecycle code (`setup`, component `onAdd` / `update`, event handlers on an attached entity) the scene is always non-null by construction, so the previous nullable return type forced noisy `!` / `?.` at every callsite. The throwing variant mirrors what `Component.scene` already did and removes that noise.

A new **`Entity.tryScene`** getter preserves the nullable return for the rare case where defensive null-awareness is genuinely needed (systems iterating a query result that may include entities mid-destroy, etc.). Migration for the handful of callsites that relied on the nullable return is a one-liner rename.

**`Entity.spawnChild` collapses** the common two-step "spawn an entity in the scene, then parent it" dance into one call, mirroring `Scene.spawn`'s overload shape. Three forms:

```ts
// 1. With an Entity subclass (optionally with setup params)
this.spawnChild("body", EnemyBody, { color: 0xff6b6b });

// 2. With a Blueprint (optionally with params)
this.spawnChild("tag", Nameplate, { label: "Grunt" });

// 3. Anonymous — no factory, just a named slot
const ui = parent.spawnChild("ui");
// ui.name === "ui"  (child-map key doubles as entity name)
```

Use the anonymous form when you want an empty child to compose components onto imperatively without declaring an Entity subclass. Returns the spawned child for chaining. Throws if the parent is detached (same policy as the new `scene` getter) and validates name uniqueness before spawning so a duplicate-name error leaves no orphan in `scene.entities`.
