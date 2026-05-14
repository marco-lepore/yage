---
"@yagejs/core": minor
"@yagejs/save": minor
"@yagejs/ui-react": minor
---

Redesign the state layer around `Reactive*` interfaces, a compound `defineStore`, and an overloaded `useStore`.

**Compound `defineStore`** is the new primary surface: one save target, many typed leaves. `s.value`, `s.counter`, `s.record`, `s.map`, `s.set`, `s.list` build the tree; the compound implements `PersistentLike` with atomic serialize/hydrate and per-tree `version` + `migrate`. `save.autoPersist(compound)` debounces N rapid leaf mutations into one write.

```ts
const game = defineStore("game", (s) => ({
  inventory: s.map<string, number>(),
  gold:      s.counter({ default: 0 }),
  shelf:     s.list<Potion>(),
  day:       s.value<number>({ default: 1 }),
}));
game.gold.increment(10);
save.autoPersist(game);
```

**Standalone factories** for one-offs: `defineRecord<T>` (renamed from old `defineStore<T>`), new `defineValue<T>`, new `defineList<T>`, plus unchanged `defineCounter`/`defineMap`/`defineSet`.

**`Reactive*` interfaces** (`ReactiveValue`, `ReactiveCounter`, `ReactiveRecord`, `ReactiveMap`, `ReactiveSet`, `ReactiveList`) are the React-facing subscription contracts. `Reactive` and the persistent types decouple subscription from persistence.

**`useStore` is overloaded** in `@yagejs/ui-react` — one overload per `Reactive*` shape plus a selector escape hatch. The selector receives the source itself (not a snapshot), so callers do `useStore(store, (src) => src.get().score)`. The compound is intentionally not accepted — read individual leaves to keep subscription granularity per-leaf.

**Breaking changes**:

- `defineStore<T>(id, opts)` is now the compound factory; the old object-record factory is `defineRecord<T>(id, opts)`.
- `PersistentMap.remove` / `PersistentSet.remove` → `.delete` (matches JS-stdlib Map/Set).
- `useStore`'s selector receives the reactive source, not a snapshot — record selectors that used `(s) => s.score` are now `(src) => src.get().score`.
- `PersistentStore<T>` type → `PersistentRecord<T>`; `DefineStoreOptions<T>` for the old API → `DefineRecordOptions<T>`.

**Additions**:

- `defineValue<T>` / `s.value` and `defineList<T>` / `s.list`.
- `PersistentCounter.clamp(value, min, max)`.
- `entries()` on `PersistentMap` and `values()` on `PersistentSet` now return arrays (were iterators); makes them safe to read repeatedly from React without re-iterating.
- Compound `subscribe` aggregates leaf changes for `save.autoPersist`.
