---
"@yagejs/core": minor
"@yagejs/save": minor
"@yagejs/ui-react": minor
---

State layer redesign: `create*` factories, three orthogonal contracts, and id/version moved to the save call site.

The registry-based `define*` API (per-primitive `id`, baked-in `version`/`migrate`, a global store registry) is replaced by plain factories with no ambient state. The persistence vocabulary is pulled out of the state primitives and into the `@yagejs/save` call site.

**Three contracts.** Every state factory in `@yagejs/core` returns a value implementing all three; each shape also carries a `[STATE_KIND]` symbol brand, and `useStore` dispatches on the brand instead of duck-typing on method names:

```ts
interface Reactive            { subscribe(fn: () => void): () => void }
interface Serializable<TEnc>  { serialize(): TEnc; hydrate(raw: TEnc): void }
interface Resettable          { reset(): void }
```

**Factories.** One factory per shape — `createValue`, `createCounter`, `createRecord`, `createMap`, `createSet`, `createList`, and the compound `createStore`. No registry, no per-primitive `id`, no per-primitive `version` / `migrate`:

```ts
import { createStore, createRecord } from "@yagejs/core";

const game = createStore((s) => ({
  inventory: s.map<string, number>(),
  gold:      s.counter({ default: 0 }),
  day:       s.value<number>({ default: 1 }),
}));
const settings = createRecord<Settings>({ default: () => ({ music: 0.8, sfx: 1.0 }) });
```

`createStore` is the primary surface: one save target, many typed leaves built via `s.value` / `s.counter` / `s.record` / `s.map` / `s.set` / `s.list`. Its `subscribe` aggregates leaf changes so `save.autoPersist` debounces N rapid leaf mutations into one write.

**Save methods take `(id, thing, opts?)`.** Id and version live at the call site, not on the primitive:

```ts
await save.persist("game", game, { version: 1 });
await save.restore("game", game, {
  version: 2,
  migrate: (old) => migrateV1ToV2(old as V1),
});
await save.saveSlot("game", "manual-1", game, { metadata: { /* … */ } });
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
- `createAtom` removed — use `createValue`.
- `@yagejs/ui-react`'s old single-record `createStore` removed — use `createRecord` from `@yagejs/core`.
- `save.restoreAll` removed — use `Promise.all([save.restore(...), …])`.
- `_resetAllStoresForTesting` / `_clearStoreRegistryForTesting` removed — there is no registry; construct fresh primitives per test.
- `useStore`'s selector receives the reactive source, not a snapshot — record selectors that used `(s) => s.score` are now `(src) => src.get().score`.

**Migration from 0.6.0.** Rename the factory call (`defineStore("id", opts)` → `createRecord(opts)`, `defineCounter("id", opts)` → `createCounter(opts)`, etc.) and move the `id` plus any `version` / `migrate` onto the matching `save.autoPersist` / `save.restore` / `save.persist` call. Group related primitives under one `createStore((s) => …)` when they share a save target. Swap `.remove(` → `.delete(` on map/set, `createAtom` → `createValue`, and any `@yagejs/ui-react` `createStore` import for `createRecord` from `@yagejs/core`.
