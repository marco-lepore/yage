---
"@yagejs/core": minor
"@yagejs/save": minor
"@yagejs/ui-react": minor
---

Split the state layer into three orthogonal contracts (`Reactive`, `Serializable<T>`, `Resettable`), drop the "Persistent" framing, and push id/version vocabulary out of primitives and into the save call site.

**Contracts.** Every state factory in `@yagejs/core` returns a value implementing all three:

```ts
interface Reactive            { subscribe(fn: () => void): () => void }
interface Serializable<TEnc>  { serialize(): TEnc; hydrate(raw: TEnc): void }
interface Resettable          { reset(): void }
```

Each shape also carries a `[STATE_KIND]` symbol brand. `useStore` dispatches on the brand instead of duck-typing on method names.

**Factories renamed `define*` → `create*`, ids and versions removed.** One factory per shape: `createValue`, `createCounter`, `createRecord`, `createMap`, `createSet`, `createList`, `createStore` (compound). No registry, no per-primitive `id`, no per-primitive `version` / `migrate`.

```ts
import { createStore, createRecord } from "@yagejs/core";

const game = createStore((s) => ({
  inventory: s.map<string, number>(),
  gold:      s.counter({ default: 0 }),
  day:       s.value<number>({ default: 1 }),
}));
const settings = createRecord<Settings>({ defaults: () => ({ music: 0.8, sfx: 1.0 }) });
```

**Save methods take `(id, thing, opts?)`.** Id and version live at the call site:

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

**`useStore` widens to all `Reactive*` shapes, including compound.** Same name; new overloads:

```ts
useStore(record); useStore(counter); useStore(map); useStore(set);
useStore(list);   useStore(value);   useStore(compound);
useStore(source, select, isEqual?);   // selector escape hatch on any reactive shape
```

**Removed.** `createAtom` (use `createValue`), ui-react's old single-record `createStore` (use `createRecord` from core), `PersistentLike` and every `Persistent*` type (replaced by `Reactive*` + `Serializable<T>`), `save.restoreAll` (use `Promise.all([save.restore(...), ...])`), `_resetAllStoresForTesting` / `_clearStoreRegistryForTesting` (construct fresh primitives per test).

**Migration.** Typical game diff: rename `defineStore("id", builder, { version, migrate })` → `createStore(builder)` and pass `{ version, migrate }` to the matching `save.autoPersist` / `save.restore` call. Standalone `defineX("id", opts)` calls become `createX(opts)` with the id passed to the save call. Swap any ui-react `createStore` for `createRecord` from `@yagejs/core`.
