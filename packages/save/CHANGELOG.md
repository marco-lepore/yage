# @yagejs/save

## 0.11.0

### Minor Changes

- [#304](https://github.com/marco-lepore/yage/pull/304) [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Remove `SnapshotPlugin`, `SnapshotService`, automatic world traversal, and
  snapshot storage. Controlled documents, named slots, migrations, adapters, and
  `SavePlugin` remain the supported persistence API.

  Fix a slot named `__proto__` saving but never appearing in `listSlots()`: the
  slot manifest now uses null-prototype maps, so any slot name is an ordinary
  entry.

### Patch Changes

- Updated dependencies [[`dc42ba4`](https://github.com/marco-lepore/yage/commit/dc42ba40cd3bbd04c8ff27bf4e8721f274dde034), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`c105024`](https://github.com/marco-lepore/yage/commit/c105024b5402c11dc36da52b08f6ab39354da8a5), [`c8ad215`](https://github.com/marco-lepore/yage/commit/c8ad215530681caeb63484cc07b118cd977a5ba5), [`08b0d06`](https://github.com/marco-lepore/yage/commit/08b0d06b63a44a51bd6f8e8308574fd41c96af59), [`33d00e3`](https://github.com/marco-lepore/yage/commit/33d00e37801a300710cc10de0352b1aa1b1ba2f1), [`7275620`](https://github.com/marco-lepore/yage/commit/7275620756183b22de3df1009e1e07615db9b40e), [`4bab66f`](https://github.com/marco-lepore/yage/commit/4bab66f0e34a387155bbc7168b048dcac167525f), [`cfde97d`](https://github.com/marco-lepore/yage/commit/cfde97de2c94416cb5bbab26a12f9c290e6b66cf), [`9e194ec`](https://github.com/marco-lepore/yage/commit/9e194ec386a74c0f1ad5699c3c0db183aa86f1b1), [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f), [`aed53f7`](https://github.com/marco-lepore/yage/commit/aed53f7f5679f824846dee3c55c0342f7f07cf98), [`ba57361`](https://github.com/marco-lepore/yage/commit/ba5736175e8b3e06157e680b4b66d10eb8d06823), [`aaf1279`](https://github.com/marco-lepore/yage/commit/aaf1279455bc655681cf15c8edc64b1407b2a823), [`8064fa6`](https://github.com/marco-lepore/yage/commit/8064fa64099feeb1d164360b668e0721a14b7bbe), [`8f11936`](https://github.com/marco-lepore/yage/commit/8f119362281bf31ab59b8b907816886922aaf18f), [`b087462`](https://github.com/marco-lepore/yage/commit/b087462ab2ae27bebb7ce274402c9e278f6d472a), [`8bb9e0b`](https://github.com/marco-lepore/yage/commit/8bb9e0b905017ac724f70fc8fe55014605563e88), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`ff52a8a`](https://github.com/marco-lepore/yage/commit/ff52a8a4816b18f7de5309ab08606183db67e071)]:
  - @yagejs/core@0.11.0

## 0.10.4

### Patch Changes

- [#287](https://github.com/marco-lepore/yage/pull/287) [`7a0d56e`](https://github.com/marco-lepore/yage/commit/7a0d56e3540e246673353b7b6facfeebedb2a51f) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Components on one entity can declare the order their `update()` / `fixedUpdate()` run in.
  - `Component.updatePriority` (instance, writable at any time) and `static updatePriority` (class default, inherited by subclasses). `ComponentUpdateSystem` calls an entity's components in ascending priority; equal priorities keep add order. Undeclared = 0, so add order is the order until a component sets a value; a negative value runs before undeclared siblings, a positive one after them.
  - Zero cost when unused: an entity iterates its component map as before until one of its components leaves priority 0, then keeps a sorted array that is rebuilt only when a component is added, removed, or has its priority written. One difference between the two paths: a component that a sibling adds during an update pass can run in that same pass on the map path, and first runs next frame on the sorted path.
  - `ComponentUpdateSystem` calls only components that are `effectiveEnabled`. Two mid-pass cases change as a result: a component that a sibling removed earlier in the pass is not called after its teardown, and when a component deactivates its own entity (`setActive(false)`), the siblings still to run in that pass are skipped — their `onDisable` has already fired.
  - The Inspector's reflected component state includes `updatePriority` when it is not 0.
  - Snapshots persist a per-instance `updatePriority` that differs from the class default (`ComponentSnapshot.updatePriority`) and re-apply it on load.

- Updated dependencies [[`7a0d56e`](https://github.com/marco-lepore/yage/commit/7a0d56e3540e246673353b7b6facfeebedb2a51f), [`753050b`](https://github.com/marco-lepore/yage/commit/753050b08270af8a73f694e27ca886613c1b57fa)]:
  - @yagejs/core@0.10.4

## 0.10.3

### Patch Changes

- Updated dependencies [[`3cb9d19`](https://github.com/marco-lepore/yage/commit/3cb9d190e4720816c7ba83a1e6fafd4b05d2684e), [`d337ce3`](https://github.com/marco-lepore/yage/commit/d337ce3a0a8eddce46117d7ff17eabbb6f2d03b3), [`f106e5d`](https://github.com/marco-lepore/yage/commit/f106e5d3bcc0f8a6a8aa449fee9a0f9c187b4d35), [`6eaad69`](https://github.com/marco-lepore/yage/commit/6eaad6992b0923ec194e3d5e5c3f1eb812afbee8), [`83c9993`](https://github.com/marco-lepore/yage/commit/83c999385c645f158dc3ef7a8cdd995fd9f2b37c), [`31d6435`](https://github.com/marco-lepore/yage/commit/31d6435fd4260363988603fdc2e292478247e314)]:
  - @yagejs/core@0.10.3

## 0.10.2

### Patch Changes

- Updated dependencies [[`ef27ea3`](https://github.com/marco-lepore/yage/commit/ef27ea3d1ff31faea4fa77fd6538bd8cadabe606), [`7f0b764`](https://github.com/marco-lepore/yage/commit/7f0b76494d72bd94866436ee46a5669c08d60372)]:
  - @yagejs/core@0.10.2

## 0.10.1

### Patch Changes

- Updated dependencies [[`d3a730b`](https://github.com/marco-lepore/yage/commit/d3a730b1dfae45338a53ddcc1267ae3e4102a34a), [`ccc0d71`](https://github.com/marco-lepore/yage/commit/ccc0d71c7f1ae4197b56a5469f61ae4145045391), [`50cc882`](https://github.com/marco-lepore/yage/commit/50cc8825c4365165a5ebfafbb6353c26660daa23)]:
  - @yagejs/core@0.10.1

## 0.10.0

### Minor Changes

- [#214](https://github.com/marco-lepore/yage/pull/214) [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Entities can now be turned off and reused instead of destroyed and respawned: `entity.setActive(false)` puts an entity and its whole subtree to sleep, and components get `onEnable` / `onDisable` to release and reacquire live resources.
  - `EntitySnapshotEntry` gains an optional `activeSelf` field, written only when an entity is dormant. Snapshots without it restore as active, so existing saves load unchanged.
  - Restore holds every entity inert until the parent links are rebuilt, then settles activeness once per subtree. Each component's `onEnable` fires exactly once, on an entity whose hierarchy is already complete.

- [#219](https://github.com/marco-lepore/yage/pull/219) [`f1048ab`](https://github.com/marco-lepore/yage/commit/f1048ab756feee84e593609521c3a58fcfc1c1a7) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `entity.handle()` gives a reference that expires with the entity's current life, so code holding on to an entity someone else retires can tell that it is gone.
  - `SnapshotResolver.handle<E>(savedId)` resolves a save-time entity id to a handle on the restored entity, the counterpart of `resolver.entity(savedId)` for references held as handles. Serialize the target's id (`this.target?.current?.id ?? null` — an explicit `null` survives a JSON round trip, a missing key does not) and restore with `resolve.handle(data.targetId)`.
  - It returns `undefined` when the id is `null` or not in the snapshot, which covers a reference empty at save time, a target destroyed before the save, and a pool member the snapshot left out.

- [#216](https://github.com/marco-lepore/yage/pull/216) [`4a5b3b6`](https://github.com/marco-lepore/yage/commit/4a5b3b639ddcbb285b6a4733b89d27bcee14c50c) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Snapshots skip `EntityPool` members and everything parented under one. A pool restores empty and refills on demand, so a pooled entity in flight at save time is gone after a load rather than coming back as an entity no pool owns.

### Patch Changes

- Updated dependencies [[`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`f1048ab`](https://github.com/marco-lepore/yage/commit/f1048ab756feee84e593609521c3a58fcfc1c1a7), [`4a5b3b6`](https://github.com/marco-lepore/yage/commit/4a5b3b639ddcbb285b6a4733b89d27bcee14c50c), [`d459026`](https://github.com/marco-lepore/yage/commit/d4590265b9aa5297fb99d20b92bb5a2f19cac0c5)]:
  - @yagejs/core@0.10.0

## 0.9.0

### Minor Changes

- [#192](https://github.com/marco-lepore/yage/pull/192) [`f6c2fa8`](https://github.com/marco-lepore/yage/commit/f6c2fa8e508620fb5356b8e4481a199115a73a45) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Snapshot restore order is now driven by a `restorePriority` static on each component class.
  - `SnapshotService` sorts each entity's component snapshots by the `restorePriority` declared on the registered class (undeclared = 100) instead of a hardcoded list of engine component names. Equal priorities restore in save-time add order; game and addon components can now participate in ordering by declaring the static.

### Patch Changes

- Updated dependencies [[`0574e44`](https://github.com/marco-lepore/yage/commit/0574e44d68df2568c57d0275aff139bddebb06da), [`3f7a367`](https://github.com/marco-lepore/yage/commit/3f7a367edc5af8d0d78e6e95bcc709bd8b77d783), [`a5d7d53`](https://github.com/marco-lepore/yage/commit/a5d7d5370fb8db567f4ceb39934574ab5c37a174), [`22f8534`](https://github.com/marco-lepore/yage/commit/22f8534e8dbc9ef054c23a570ab851f8710db68f), [`da97f10`](https://github.com/marco-lepore/yage/commit/da97f10ba7cb7627f48efccf3bfe1836bfac3dbc), [`f6c2fa8`](https://github.com/marco-lepore/yage/commit/f6c2fa8e508620fb5356b8e4481a199115a73a45), [`10d3ac5`](https://github.com/marco-lepore/yage/commit/10d3ac5ec3f3dca593f35728b175df3bfd073bb6), [`8a933db`](https://github.com/marco-lepore/yage/commit/8a933db95eedb908ad98e95631d5022fe1e0ef28), [`9b637bc`](https://github.com/marco-lepore/yage/commit/9b637bcd832476a6c47eb4dacb8cf33e9c5139b0), [`9b02d02`](https://github.com/marco-lepore/yage/commit/9b02d024fe54ea30efef01a109387b839266b791), [`8156b6d`](https://github.com/marco-lepore/yage/commit/8156b6dcc8429b738c3efeb949fafd1cce245330), [`8d061c5`](https://github.com/marco-lepore/yage/commit/8d061c54eb0bbf3aed75b2b943fef1affdce7667)]:
  - @yagejs/core@0.9.0

## 0.8.0

### Minor Changes

- [#112](https://github.com/marco-lepore/yage/pull/112) [`8e2ab0b`](https://github.com/marco-lepore/yage/commit/8e2ab0b301748c2ac5f3d90224d3a2cc92393865) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add a per-entity `timeScale` multiplier (closes [#92](https://github.com/marco-lepore/yage/issues/92)).
  - `Entity.timeScale` (default `1`) scales the delta time the engine feeds an
    entity's components: `dt * scene.timeScale * entity.timeScale`. It composes
    on top of the scene's `timeScale`, so `0` freezes a single entity while the
    scene keeps running and `2` runs it at double speed.
  - Applies to component `update()` / `fixedUpdate()`
    (`ComponentUpdateSystem`), the entity's `ProcessComponent` tween tick
    (`ProcessSystem` — scene-scoped processes stay scene-only), and the entity's
    particle emitters (`ParticleSystem`).
  - Physics is deliberately carved out: a scene shares one Rapier world stepped
    once per (scene-scaled) fixed tick, so a rigid body cannot be individually
    time-scaled. Use `scene.timeScale`, a kinematic body, or manual velocity
    scaling for per-body time control.
  - `entity.timeScale` is captured and restored by the save snapshot (omitted
    from the snapshot when left at the default to keep saves compact).

### Patch Changes

- Updated dependencies [[`62da81f`](https://github.com/marco-lepore/yage/commit/62da81f67076fccaff3a8af6c805dd919c6a687f), [`8e2ab0b`](https://github.com/marco-lepore/yage/commit/8e2ab0b301748c2ac5f3d90224d3a2cc92393865), [`face78b`](https://github.com/marco-lepore/yage/commit/face78ba63f9ef6eb52d8a677fc1d8b1457212e6), [`555a868`](https://github.com/marco-lepore/yage/commit/555a86888ec3aedca42587fab7eb3ec5f0c6eeb8), [`4627c80`](https://github.com/marco-lepore/yage/commit/4627c80e409226ff58c2214c2e1bb76e9e1d769f), [`3991288`](https://github.com/marco-lepore/yage/commit/39912883cf191cd065ef0b5779f1b65b53bcbea8), [`23e357f`](https://github.com/marco-lepore/yage/commit/23e357f605957cc24e58ec2e504a82d4ebdcc9a0)]:
  - @yagejs/core@0.8.0

## 0.7.0

### Minor Changes

- [#76](https://github.com/marco-lepore/yage/pull/76) [`7ca5050`](https://github.com/marco-lepore/yage/commit/7ca5050d91479121039af5e4898fc0c220e8d7c3) Thanks [@marco-lepore](https://github.com/marco-lepore)! - State layer redesign: `create*` factories, three orthogonal contracts, and id/version moved to the save call site.

  The registry-based `define*` API (per-primitive `id`, baked-in `version`/`migrate`, a global store registry) is replaced by plain factories with no ambient state. The persistence vocabulary is pulled out of the state primitives and into the `@yagejs/save` call site.

  **Three contracts.** Every state factory in `@yagejs/core` returns a value implementing all three; each shape also carries a `[STATE_KIND]` symbol brand, and `useStore` dispatches on the brand instead of duck-typing on method names:

  ```ts
  interface Reactive {
    subscribe(fn: () => void): () => void;
  }
  interface Serializable<TEnc> {
    serialize(): TEnc;
    hydrate(raw: TEnc): void;
  }
  interface Resettable {
    reset(): void;
  }
  ```

  **Factories.** One factory per shape — `createValue`, `createCounter`, `createRecord`, `createMap`, `createSet`, `createList`, and the compound `createStore`. No registry, no per-primitive `id`, no per-primitive `version` / `migrate`:

  ```ts
  import { createStore, createRecord } from "@yagejs/core";

  const game = createStore((s) => ({
    inventory: s.map<string, number>(),
    gold: s.counter({ default: 0 }),
    day: s.value<number>({ default: 1 }),
  }));
  const settings = createRecord<Settings>({
    default: () => ({ music: 0.8, sfx: 1.0 }),
  });
  ```

  `createStore` is the primary surface: one save target, many typed leaves built via `s.value` / `s.counter` / `s.record` / `s.map` / `s.set` / `s.list`. Its `subscribe` aggregates leaf changes so `save.autoPersist` debounces N rapid leaf mutations into one write.

  **Save methods take `(id, thing, opts?)`.** Id and version live at the call site, not on the primitive:

  ```ts
  await save.persist("game", game, { version: 1 });
  await save.restore("game", game, {
    version: 2,
    migrate: (old) => migrateV1ToV2(old as V1),
  });
  await save.saveSlot("game", "manual-1", game, {
    metadata: {
      /* … */
    },
  });
  save.autoPersist("settings", settings);
  ```

  `StoreVersionTooNewError` and `StoreMigrationMissingError` moved from `@yagejs/core` to `@yagejs/save`.

  **`useStore` widens to all `Reactive*` shapes, including compound** (`@yagejs/ui-react`). Same name; one overload per shape plus a selector escape hatch that receives the reactive source itself:

  ```ts
  useStore(record); useStore(counter); useStore(map); useStore(set);
  useStore(list);   useStore(value);   useStore(compound);
  useStore(source, (src) => src.get().score, isEqual?);
  ```

  **Additions over 0.6.0.** `createValue` / `s.value` and `createList` / `s.list` (new shapes); the compound `createStore`; `ReactiveCounter.clamp(value, min, max)`; `entries()` on maps and `values()` on sets now return arrays (were iterators) so React can read them repeatedly without re-iterating.

  **Breaking changes.**
  - All factories renamed `define*` → `create*`. `defineStore<T>(id, opts)` (the old object-record factory) → `createRecord<T>(opts)`; `defineCounter` / `defineMap` / `defineSet` → `createCounter` / `createMap` / `createSet`, with the per-primitive `id` removed.
  - `PersistentLike` and every `Persistent*` type are gone — replaced by `Reactive*` + `Serializable<T>`. `createRecord`'s return type is now a `Reactive*` shape (`ReactiveRecord<T>`), not `PersistentStore<T>`.
  - `PersistentMap.remove` / `PersistentSet.remove` → `.delete` (matches JS-stdlib `Map`/`Set`).
  - The factory default option renamed `defaults` → `default` and now accepts a value or a factory (`default: T | (() => T)`, was `defaults: () => T`). Passing the old `defaults` key is silently ignored and you get the zero/empty default instead — grep call sites, this one fails without a type error in loosely-typed setups.
  - `createAtom` removed — use `createValue`.
  - `@yagejs/ui-react`'s old single-record `createStore` removed — use `createRecord` from `@yagejs/core`.
  - `save.restoreAll` removed — use `Promise.all([save.restore(...), …])`.
  - `_resetAllStoresForTesting` / `_clearStoreRegistryForTesting` removed — there is no registry; construct fresh primitives per test.
  - `useStore`'s selector receives the reactive source, not a snapshot — record selectors that used `(s) => s.score` are now `(src) => src.get().score`.

  **Migration from 0.6.0.** Rename the factory call (`defineStore("id", opts)` → `createRecord(opts)`, `defineCounter("id", opts)` → `createCounter(opts)`, etc.) and move the `id` plus any `version` / `migrate` onto the matching `save.autoPersist` / `save.restore` / `save.persist` call. Group related primitives under one `createStore((s) => …)` when they share a save target. Swap the `defaults:` option key for `default:`, `.remove(` → `.delete(` on map/set, `createAtom` → `createValue`, and any `@yagejs/ui-react` `createStore` import for `createRecord` from `@yagejs/core`.

### Patch Changes

- Updated dependencies [[`069d41e`](https://github.com/marco-lepore/yage/commit/069d41e711aeb6218c1438f52a2b098ff8946526), [`90e4d30`](https://github.com/marco-lepore/yage/commit/90e4d3064d9c2804549d62844067cf487d592f0a), [`57a6441`](https://github.com/marco-lepore/yage/commit/57a6441f9ef8b5f7140959d6393930c2326d70e0), [`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40), [`7ca5050`](https://github.com/marco-lepore/yage/commit/7ca5050d91479121039af5e4898fc0c220e8d7c3)]:
  - @yagejs/core@0.7.0

## 0.6.0

### Minor Changes

- [#55](https://github.com/marco-lepore/yage/pull/55) [`e4d8823`](https://github.com/marco-lepore/yage/commit/e4d882380e37a02c8fd259c5019c576a46f9aa89) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Typed reactive stores in core + a new Save IO instance built on them; snapshot system renamed to free the `Save*` namespace.
  - **Breaking**: snapshot system renamed to the `Snapshot*` prefix to free `Save*` for the new persistence path. `SaveService` → `SnapshotService`, `SavePlugin` → `SnapshotPlugin`, `SaveServiceKey` → `SnapshotServiceKey`, `SaveStorage` → `SnapshotStorage`, `LocalStorageSaveStorage` → `LocalStorageSnapshotStorage`. Plugin name changes from `"save"` to `"snapshot"`. Sources moved under `src/snapshot/`. `SNAPSHOT_VERSION` is unchanged (still 4) — no on-disk format changes. Pre-1.0; no compat aliases.
  - New `Save` IO instance via `createSave({ adapter })`: `persist` / `restore` / `restoreAll` for unslotted documents; `saveSlot<M>` / `loadSlot` / `listSlots<M>` / `deleteSlot` for slotted writes with typed metadata; `autoPersist` for microtask-coalesced background writes (works outside the engine loop).
  - New `SavePlugin` is a thin DI bridge that registers a user-constructed `Save` instance under `SaveServiceKey` for component access — no global mutable state.
  - Adapters: `localStorageAdapter` (browser default), `memoryAdapter` (tests + Node). Slot manifests live at `${id}:__slots__` for fast metadata listing; non-atomic-write trade-off documented inline.
  - New errors: `SlotNotFoundError`, `DocumentNotFoundError`. Cooperates with core's `StoreVersionTooNewError` / `StoreMigrationMissingError`.
  - Re-exports core store primitives (`defineStore` et al.) so users can pull them from `@yagejs/save` when they prefer to think of them as a save concern.

### Patch Changes

- Updated dependencies [[`1126143`](https://github.com/marco-lepore/yage/commit/11261436719fed28472cec3143281632f082add5), [`fe4aabc`](https://github.com/marco-lepore/yage/commit/fe4aabcf25525d078e584ab96e69dd907d96bc7c)]:
  - @yagejs/core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [[`cf617fe`](https://github.com/marco-lepore/yage/commit/cf617fe0f28db6ea1a5af7992b76dc19eec8cd0c), [`bc3790d`](https://github.com/marco-lepore/yage/commit/bc3790dc4c31c42c4821cd275a9376a0830bb0db), [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b), [`114d246`](https://github.com/marco-lepore/yage/commit/114d246820a88e68841a4f9cec2167c188269970)]:
  - @yagejs/core@0.5.0

## 0.4.0

### Minor Changes

- [#44](https://github.com/marco-lepore/yage/pull/44) [`e7d6645`](https://github.com/marco-lepore/yage/commit/e7d6645f9acff27269fa6f6e52032482651b146d) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Effects preset package + handle-based save/load for effects and masks.
  - New `@yagejs/effects` package: ten hero presets — `hitFlash`, `bloom`, `outline`, `dropShadow`, `pixelate`, `glow`, `crt`, `chromaticAberration`, `vignette`, `colorGrade`. Each preset registers under a stable `yage:<name>` string via `defineEffect` so it survives save/load.
  - Renderer: new `defineEffect` / `defineMask` registries; `EffectStack.serialize` / `restoreFrom`; `MaskHandle.serialize`; `restoreMask` helper. The 4 visual components now persist their effects + mask through `serialize` / `afterRestore`. A `RendererSnapshotContributor` is auto-registered with `SaveService` (when present) to cover layer / scene / screen-scope effects + masks.
  - Save: new `SnapshotContributor` extension hook (`registerSnapshotExtra` / `unregisterSnapshotExtra`) so plugins can extend `GameSnapshot.extras`. Snapshot version bumped 3 → 4 — older saves no longer load.

  `rawFilter`, `spriteMask`, and `graphicsMask` skip serialization with a one-shot warning since they have no string identity to record. In-flight `fadeIn` / `fadeOut` tweens are not preserved across save/load.

### Patch Changes

- Updated dependencies [[`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805)]:
  - @yagejs/core@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [[`69f8449`](https://github.com/marco-lepore/yage/commit/69f844942d1596228a6ed50a37ec8e6f1d821353), [`60d2067`](https://github.com/marco-lepore/yage/commit/60d20671e31230f5fcef127203efb127bdfedf92), [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb)]:
  - @yagejs/core@0.3.0

## 0.2.0

### Patch Changes

- [#22](https://github.com/marco-lepore/yage/pull/22) [`083b05b`](https://github.com/marco-lepore/yage/commit/083b05bd9c9557ef32b9b82939e792983c4a5f9b) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Align with the new async scene-manager API.
  - `SaveService.loadSnapshot` awaits `sceneManager.popAll()` before restoring scenes, matching the new async API.

- Updated dependencies [[`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`fc717ba`](https://github.com/marco-lepore/yage/commit/fc717bac2bc530a2c396da604d614f762d272232), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c)]:
  - @yagejs/core@0.2.0
