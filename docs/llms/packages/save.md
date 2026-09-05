# @yagejs/save

Depends on `@yagejs/core`. Controlled persistence for typed reactive stores or
any explicit `Serializable<TEncoded>` state root. The package does not traverse
scenes, entities, components, renderer resources, callbacks, or plugin
internals.

## Setup

```ts yage-group="stores"
import { Engine } from "@yagejs/core";
import { createSave, SavePlugin, localStorageAdapter } from "@yagejs/save";

const save = createSave({
  adapter: localStorageAdapter({ namespace: "my-game" }),
});

const engine = new Engine();
engine.use(new SavePlugin({ save }));
```

`save` is constructed in your code (typically `main.ts`) and registered through the plugin so components can resolve it via `SaveServiceKey`. No globals.

`save` is also usable before `engine.start()` — boot-time `restore` of settings is the canonical pattern.

## Reactive values from `@yagejs/core`

Save consumes any `Serializable<T>`. The reactive factories live in `@yagejs/core`:

```ts yage-group="stores"
interface SettingsData {
  audio: { music: number; sfx: number };
  vsync: boolean;
}

import {
  createStore,
  createRecord,
  createValue,
  createCounter,
  createMap,
  createSet,
  createList,
} from "@yagejs/core";

interface Potion {
  name: string;
  quality: number;
}

// Compound — bundle leaves so they serialize/restore atomically.
const game = createStore((s) => ({
  inventory: s.map<string, number>(),
  recipes: s.set<string>(),
  gold: s.counter({ default: 0 }),
  reputation: s.counter({ default: 50 }),
  shelf: s.list<Potion>(),
  day: s.value<number>({ default: 1 }),
  settings: s.record<{ volume: number; lang: string }>({
    default: () => ({ volume: 0.8, lang: "en" }),
  }),
}));
game.gold.increment(10);
game.inventory.set("moonleaf", 3);

// Save the whole tree as one document — id and (optional) version at the
// save call site:
save.autoPersist("save-stores.run", game);

// Leaf factories — usable on their own:
export const settings = createRecord<SettingsData>({
  default: () => ({ audio: { music: 0.8, sfx: 1.0 }, vsync: true }),
});
export const opened = createSet<string>();
export const defeated = createMap<string, number>();
```

Leaf builder methods on the compound: `s.value<T>({ default, codec? })`, `s.counter({ default? })`, `s.record<T>({ default, codec? })`, `s.map<K,V>({ default? })`, `s.set<K>({ default? })`, `s.list<T>({ default? })`. Reserved leaf keys: `subscribe`, `serialize`, `hydrate`, `reset` — collisions throw at construction.

Shape APIs (every leaf also exposes `subscribe(fn)`, `serialize()`, `hydrate(raw)`, `reset()`):

- `createRecord<T>` / `s.record`: `get(): Readonly<T>`, `set(partial: Partial<T>)`, `delete(key)` (removes the key; index-signature and optional keys only — a required key is a compile error).
- `createValue<T>` / `s.value`: `get(): T`, `set(v: T)`.
- `createCounter` / `s.counter`: `value()`, `set(n)`, `increment(by?)`, `decrement(by?)`, `clamp(value, min, max)`.
- `createMap<K, V>` / `s.map`: `get(k)`, `set(k, v)`, `delete(k)`, `has(k)`, `entries()`, `size()`, `clear()`.
- `createSet<K>` / `s.set`: `add(k)`, `delete(k)`, `has(k)`, `values()`, `size()`, `clear()`.
- `createList<T>` / `s.list`: `add(item): number` (returns id), `remove(id): boolean`, `get(id)`, `update(id, partial)`, `list()` (insertion order), `size()`, `clear()`. Ids are monotonic and stable across save/restore.

### Migrating N leaf factories to one compound

```ts
import { createSave, memoryAdapter } from "@yagejs/save";
const save = createSave({ adapter: memoryAdapter() });
import {
  createRecord,
  createCounter,
  createSet,
  createStore,
} from "@yagejs/core";
interface RunData {
  chapter: number;
  coins: number;
}

// Before — three save documents, three autoPersist calls.
const progression = createRecord<RunData>({
  default: () => ({ chapter: 1, coins: 0 }),
});
const deaths = createCounter();
const flags = createSet<string>();
save.autoPersist("run.progression", progression);
save.autoPersist("run.deaths", deaths);
save.autoPersist("run.flags", flags);

// After — one document, one autoPersist call, atomic serialize/hydrate.
const game = createStore((s) => ({
  progression: s.record<RunData>({ default: () => ({ chapter: 1, coins: 0 }) }),
  deaths: s.counter({ default: 0 }),
  flags: s.set<string>(),
}));
save.autoPersist("run", game);
```

## Save instance API

All methods take `(id, thing, opts?)`. `thing` is any `Serializable<T>`; the id and optional version live at the call site.

```ts yage-group="stores"
const a = createCounter();
const b = createCounter();
const profile = "player-1";

// Unslotted single-document
await save.persist("settings", settings);
await save.restore("settings", settings);
await Promise.all([save.restore("a", a), save.restore("b", b)]);

// Slotted with typed metadata
interface RunMeta {
  location: string;
  playtime: number;
}
await save.saveSlot<unknown, RunMeta>("run", "manual-1", game, {
  metadata: { location: "Forest", playtime: 60 },
});
await save.loadSlot("run", "manual-1", game);
const slots = await save.listSlots<RunMeta>("run");
// -> [{ name: "manual-1", savedAt: 1714..., metadata: {...} }, ...]
await save.deleteSlot("run", "manual-1");

// Auto-persist — coalesces synchronous mutations into one write per microtask.
// Requires `Reactive & Serializable<T>` (every create* factory qualifies).
const stop = save.autoPersist("settings", settings);

// Multi-profile via hierarchical slot names + prefix filter
await save.saveSlot("run", `${profile}/manual-1`, game);
await save.listSlots("run", { prefix: `${profile}/` });
```

`version` is optional on every write/read (defaults to `1`). Migration runs on read when stored version < current:

```ts
import { createSave, memoryAdapter } from "@yagejs/save";
const save = createSave({ adapter: memoryAdapter() });
import { createRecord } from "@yagejs/core";
interface V1 {
  coins: number;
}
interface V2 {
  coins: number;
  chapter: number;
}
const game = createRecord<V2>({ default: () => ({ coins: 0, chapter: 1 }) });
const migrateV1ToV2 = (old: V1): V2 => ({ ...old, chapter: 1 });

await save.restore("run", game, {
  version: 2,
  migrate: (old, fromVersion) => migrateV1ToV2(old as V1),
});
```

Errors:

- `SlotNotFoundError` — `loadSlot` on a slot that doesn't exist.
- `StoreVersionTooNewError` — stored version is greater than the read's `version`.
- `StoreMigrationMissingError` — stored version is older and no `migrate` configured.
- `CorruptPayloadError` — the stored payload isn't a valid version envelope (corrupt, legacy, or written by something other than `Save`).
- `InvalidKeyError` — empty store id or slot name passed to `Save` methods.

## Boot pattern

```ts yage-group="boot" yage-file="persistence/stores.ts"
import { createRecord, createSet, createMap } from "@yagejs/core";
export const settings = createRecord<{ volume: number }>({
  default: () => ({ volume: 0.8 }),
});
export const saves = createRecord<{ chapter: number }>({
  default: () => ({ chapter: 1 }),
});
export const opened = createSet<string>();
export const defeated = createMap<string, number>();
```

```ts yage-group="boot" yage-file="persistence/save.ts"
import { createSave, localStorageAdapter } from "@yagejs/save";
export const save = createSave({ adapter: localStorageAdapter() });
```

```ts yage-group="boot" yage-file="main.ts"
import { Engine } from "@yagejs/core";
import { SavePlugin } from "@yagejs/save";
// game/main.ts
import { settings, saves, opened, defeated } from "./persistence/stores.js";
import { save } from "./persistence/save.js";

await Promise.all([
  save.restore("settings", settings),
  save.restore("saves", saves),
  save.restore("world.opened", opened),
  save.restore("world.defeated", defeated),
]);
save.autoPersist("settings", settings);
save.autoPersist("saves", saves);

const engine = new Engine();
engine.use(new SavePlugin({ save }));
await engine.start();
```

## Continue pattern

```ts yage-group="boot" yage-file="continue.ts"
import { save } from "./persistence/save.js";
import { saves } from "./persistence/stores.js";

const slots = await save.listSlots("saves");
const latest = slots.sort((a, b) => b.savedAt - a.savedAt)[0];
if (latest) {
  await save.loadSlot("saves", latest.name, saves);
}
```

## Component access

```ts yage-group="boot" yage-file="checkpoint.ts"
import { Component, defineEvent } from "@yagejs/core";
import { saves } from "./persistence/stores.js";
const Rested = defineEvent<void>("rested");

import { SaveServiceKey } from "@yagejs/save";

class CheckpointOnRest extends Component {
  onAdd() {
    this.listen(this.entity, Rested, async () => {
      const save = this.use(SaveServiceKey);
      await save.saveSlot("saves", "auto", saves);
    });
  }
}
```

## Codecs

Stores accept a `Codec<T, TEncoded>` for non-JSON-native value types. `TEncoded` defaults to `T` for identity codecs and appears in `serialize()`/`hydrate()` and `RestoreOptions.migrate` so migrations get the right type. Built-ins live in `@yagejs/core`:

```ts
import { jsonCodec, setCodec, mapCodec, dateCodec } from "@yagejs/core";

jsonCodec<{ volume: number }>(); // Codec<T, T>            — identity (default)
setCodec<string>(); // Codec<Set<K>, K[]>
mapCodec<string, number>(); // Codec<Map<K,V>, [K,V][]>
dateCodec(); // Codec<Date, string>    — ISO string
```

`createSet`/`createMap`/`createCounter`/`createList` bundle codecs internally — you only specify a codec for `createRecord<T>` / `createValue<T>` (and the compound `s.record`/`s.value` leaves) when `T` contains exotic types. When a custom codec changes the encoded shape (e.g. `Date → string`), declare both generics: `createValue<Date, string>({ default: () => new Date(), codec: dateCodec() })`.

## Adapters

```ts
import { localStorageAdapter, memoryAdapter } from "@yagejs/save";

localStorageAdapter({ namespace: "game" }); // browser; namespaces every key
memoryAdapter(); // in-memory; tests + Node
```

`SaveAdapter` interface:

```ts
interface SaveAdapter {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}
```

## Storage layout

Adapter keys are URI-encoded segments joined by `/` so legal store ids and
slot names (including those containing `:` or `/`) can never overlap. For a
store with id `saves`:

```text
saves/d                    ← unslotted document (persist/restore)
saves/s/manual-1           ← slot data
saves/s/auto               ← slot data
saves/m                    ← slot manifest (savedAt + metadata)
```

`listSlots` reads the manifest, not adapter `list()` — metadata is fast and atomic with each save.

## Migration

`version` + `migrate` live on the read call (`restore` / `loadSlot` / `autoPersist`), not on the primitive. Per-leaf migration is not supported.

```ts
import { createSave, memoryAdapter } from "@yagejs/save";
const save = createSave({ adapter: memoryAdapter() });
import { createRecord, createStore } from "@yagejs/core";
interface RunData {
  inventory: string[];
  position: { x: number; y: number };
}
function initialRun(): RunData {
  return { inventory: [], position: { x: 0, y: 0 } };
}

// Single record:
const saves = createRecord<RunData>({ default: () => initialRun() });
await save.restore("saves", saves, {
  version: 3,
  migrate: (old, fromVersion) => {
    if (fromVersion < 2) {
      const v1 = old as { startPos: RunData["position"] };
      return { inventory: [], position: v1.startPos };
    }
    const v2 = old as { inventory: string[]; startPos: RunData["position"] };
    return { inventory: v2.inventory, position: v2.startPos };
  },
});

// Compound — migrate the whole tree at once. Return the new encoded form
// each leaf consumes: `{ gold: number, day: { value: number } }` here.
const game = createStore((s) => ({
  gold: s.counter({ default: 0 }),
  day: s.value<number>({ default: 1 }),
}));
await save.restore("run", game, {
  version: 2,
  migrate: (old) => {
    const v1 = old as { gold: number };
    return { gold: v1.gold, day: { value: 7 } };
  },
});
```

A stored version newer than the read's `version` throws `StoreVersionTooNewError`.

## Test setup

```ts yage-context="vitest"
import { createSave, memoryAdapter } from "@yagejs/save";
import { createRecord } from "@yagejs/core";

const save = createSave({ adapter: memoryAdapter() });

beforeEach(() => {
  // No registry to reset — construct fresh primitives per test.
});
```

## Per-frame updates: don't

Stores are for _intentional_ state — settings, slots, world facts, progression. They notify all subscribers synchronously on every change, and UI bindings re-render. **Don't update stores from `update(dt)` or other per-frame paths**; that's what ECS state and `useQuery`/`useSceneSelector` are for. If you find yourself debouncing every set, you're using the wrong primitive.

## Custom state roots

Implement `Serializable<TEncoded>` when the state does not fit a built-in
factory. `serialize()` returns the complete durable representation and
`hydrate()` replaces the model from that representation. Use the same Save
methods as for a store.

Do not pass live ECS or renderer objects as state roots. Save stable facts such
as scene identity, entity kind, position, health, inventory, and quest state.
After load, normal scene setup reconstructs entities, components, processes,
physics bodies, effects, and event listeners from those facts.
