# @yagejs/save

Depends on `@yagejs/core`. Controlled persistence for typed reactive stores or
any explicit `Serializable<TEncoded>` state root. The package does not traverse
scenes, entities, components, renderer resources, callbacks, or plugin
internals.

## Setup

```ts
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

```ts yage-group="save" yage-file="persistence/stores.ts"
// game/persistence/stores.ts
import {
  createStore,
  createRecord,
  createValue,
  createCounter,
  createMap,
  createSet,
  createList,
} from "@yagejs/core";
import { save } from "./save.js";

interface Potion {
  name: string;
  quality: number;
}
interface SettingsData {
  audio: { music: number; sfx: number };
  vsync: boolean;
}
export type RunData = {
  chapter: number;
  coins: number;
  inventory: string[];
  position: { x: number; y: number };
};
export const initialRun = (): RunData => ({
  chapter: 1,
  coins: 0,
  inventory: [],
  position: { x: 0, y: 0 },
});

// Compound — bundle leaves so they serialize/restore atomically.
export const game = createStore((s) => ({
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
export const saves = createRecord<RunData>({ default: initialRun });
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

```ts yage-group="save" yage-file="migrate-to-compound.ts"
import {
  createCounter,
  createRecord,
  createSet,
  createStore,
} from "@yagejs/core";
import { save } from "./persistence/save.js";

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

```ts yage-group="save" yage-file="api.ts"
import { save } from "./persistence/save.js";
import { game, settings, opened, defeated } from "./persistence/stores.js";

// Unslotted single-document
await save.persist("settings", settings);
await save.restore("settings", settings);
await Promise.all([
  save.restore("world.opened", opened),
  save.restore("world.defeated", defeated),
]);

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
// -> newest first: [{ name: "manual-1", savedAt: 1714..., metadata: {...} }, ...]
await save.deleteSlot("run", "manual-1");

// Auto-persist — coalesces synchronous mutations into one write per microtask.
// Requires `Reactive & Serializable<T>` (every create* factory qualifies).
const stop = save.autoPersist("settings", settings);
await save.flush(); // waits for autoPersist writes; rejects if the latest one failed

// Multi-profile via hierarchical slot names + prefix filter
const profile = "alice"; // the active profile's name
await save.saveSlot("run", `${profile}/manual-1`, game);
await save.listSlots("run", { prefix: `${profile}/` });
```

`version` is optional on every write/read (defaults to `1`). Migration runs on read when stored version < current:

```ts yage-group="save" yage-file="versioning.ts"
import { createRecord } from "@yagejs/core";
import { save } from "./persistence/save.js";

interface V1 {
  coins: number;
}
interface V2 {
  coins: number;
  chapter: number;
}
const migrateV1ToV2 = (old: V1): V2 => ({ ...old, chapter: 1 });
const game = createRecord<V2>({ default: () => ({ coins: 0, chapter: 1 }) });

await save.restore("run", game, {
  version: 2,
  migrate: (old, fromVersion) => migrateV1ToV2(old as V1),
});
```

Errors:

- `SlotNotFoundError` — `loadSlot` on a slot that doesn't exist.
- `StoreVersionTooNewError` — stored version is greater than the read's `version`.
- `StoreMigrationMissingError` — stored version is older and no `migrate` configured.
- `CorruptPayloadError` — the stored bytes aren't JSON, or aren't a valid version envelope (corrupt, legacy, or written by something other than `Save`).
- `InvalidKeyError` — empty store id or slot name passed to `Save` methods.
- `AggregateError` — from `flush()`, when the latest automatic write of one or more stores failed. `errors` holds those failures.

## Boot pattern

```ts yage-group="save" yage-file="persistence/save.ts"
// game/persistence/save.ts
import { createSave, localStorageAdapter } from "@yagejs/save";

export const save = createSave({
  adapter: localStorageAdapter({ namespace: "my-game" }),
});
```

```ts yage-group="save" yage-file="main.ts"
// game/main.ts
import { Engine } from "@yagejs/core";
import { SavePlugin } from "@yagejs/save";
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

```ts yage-group="save" yage-file="continue.ts"
import { save } from "./persistence/save.js";
import { saves } from "./persistence/stores.js";

const [latest] = await save.listSlots("saves");
if (latest) {
  await save.loadSlot("saves", latest.name, saves);
}
```

## Component access

```ts yage-group="save" yage-file="checkpoint.ts"
import { Component, defineEvent } from "@yagejs/core";
import { SaveServiceKey } from "@yagejs/save";
import { saves } from "./persistence/stores.js";

const Rested = defineEvent("rested");

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
import type { Codec } from "@yagejs/core";

// Built-in codecs exported by @yagejs/core:
declare function jsonCodec<T>(): Codec<T, T>; // identity (default)
declare function setCodec<K>(): Codec<Set<K>, K[]>;
declare function mapCodec<K, V>(): Codec<Map<K, V>, [K, V][]>;
declare function dateCodec(): Codec<Date, string>; // ISO string
```

`createSet`/`createMap`/`createCounter`/`createList` bundle codecs internally — you only specify a codec for `createRecord<T>` / `createValue<T>` (and the compound `s.record`/`s.value` leaves) when `T` contains exotic types. When a custom codec changes the encoded shape (e.g. `Date → string`), declare both generics: `createValue<Date, string>({ default: () => new Date(), codec: dateCodec() })`.

## Adapters

```ts
import type { SaveAdapter, SaveFileStore } from "@yagejs/save";

// Adapter factories exported by @yagejs/save:
// Browser; namespaces every key.
declare function localStorageAdapter(opts?: {
  namespace?: string;
}): SaveAdapter;
// In-memory; tests + Node.
declare function memoryAdapter(): SaveAdapter;
// Any directory of files, including one reached over a native bridge.
declare function fileAdapter(opts: { store: SaveFileStore }): SaveAdapter;
```

`SaveAdapter` interface:

```ts
import type { SaveAdapter as BaseSaveAdapter } from "@yagejs/save";

interface SaveAdapter extends BaseSaveAdapter {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}
```

Every adapter, including one you write, guarantees for each key:

- **Atomic replace** — after an interrupted `write` or `delete`, `read` returns the previous value or the new one, never a mix.
- **Completion** — a resolved `write` or `delete` is reflected by every later `read` and `list`, and is held by the storage when the process is killed afterwards.
- **Order** — operations on one key take effect in call order.
- **Failure** — an operation that cannot complete rejects; a rejected `write` leaves the previous value or the new one.

Different keys are independent: two writes are never one transaction. State that has to change together goes in one document, which is what a `createStore` compound gives you.

What each adapter survives:

| Adapter                                                | Process kill                                                                     | Power loss                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- | -------------------------------- |
| `memoryAdapter`                                        | no — the values live in the process                                              | no                               |
| `localStorageAdapter`                                  | the browser commits on its own schedule; the last writes can be lost, never torn | the browser's                    |
| `fileAdapter` over a store whose `write` syncs         | yes                                                                              | where the sync reaches the drive |
| `fileAdapter` over a store whose `write` does not sync | yes                                                                              | not guaranteed                   |

`electronSaveAdapter()` from `@yagejs/host-electron` is the desktop adapter: a `fileAdapter` over the app's data directory, running in Electron's main process, so a renderer that crashes during a save does not stop the write. On macOS each write reaches the drive before it resolves.

`capacitorSaveAdapter({ profile })` from `@yagejs/host-capacitor` is the mobile adapter: a `fileAdapter` over a directory in the app's private Library directory, one per build profile. A write that resolved is held when the system kills the app; neither mobile system's write reaches the storage hardware, so a power loss is not guaranteed.

### `fileAdapter`

```ts
/** A directory of files that a fileAdapter keeps its values in. */
interface SaveFileStore {
  read(name: string): Promise<string | null>;
  write(name: string, content: string): Promise<void>;
  delete(name: string): Promise<void>;
  list(): Promise<string[]>;
}
```

A store's `write` may leave a partial file when it is interrupted; `fileAdapter` adds the guarantees above on top of it. Each value goes to a shadow file first, then to the main file, and both carry a length and a checksum, so an interrupted write leaves the previous value or the new one readable. Keys are at most 96 bytes in UTF-8, which keeps the longest file name at 160 characters. File names are `k-<base32 of the key>.sav` and `.new`, so they hold only `a-z`, `2-7`, `-` and `.`.

```ts yage-group="file-store"
import { fileAdapter, createSave } from "@yagejs/save";
import type { SaveFileStore } from "@yagejs/save";

const files = new Map<string, string>();
const store: SaveFileStore = {
  async read(name) {
    return files.get(name) ?? null;
  },
  async write(name, content) {
    files.set(name, content);
  },
  async delete(name) {
    files.delete(name);
  },
  async list() {
    return [...files.keys()];
  },
};

export const save = createSave({ adapter: fileAdapter({ store }) });
```

## Storage layout

Adapter keys are URI-encoded segments joined by `/` so legal store ids and
slot names (including those containing `:` or `/`) can never overlap. For a
store with id `saves`:

```text
saves/d                    ← unslotted document (persist/restore)
saves/s/manual-1           ← slot document: { version, data, savedAt, metadata? }
saves/s/auto               ← slot document
saves/m                    ← only in a store written by an earlier release
```

A slot is one document, so `saveSlot` and `deleteSlot` are one storage operation each. `listSlots` calls the adapter's `list` with `saves/s/` and reads every listed document (10 documents of 1 MB parse in about 7 ms in Node; a native bridge adds its own cost), sorts newest first, and leaves out a document that carries no slot details. A `saves/m` left by an earlier release is merged into the slot documents the first time `listSlots`, `saveSlot` or `deleteSlot` touches that store, then removed.

## Interruptions and failures

- **One document is the unit that changes atomically.** Two keys never change together, so group state that must agree into one compound store.
- **A resolved `persist`, `saveSlot` or `deleteSlot` means the storage holds the value** and every later read sees it. Surviving a power loss is the storage's promise, not the engine's; see the table above.
- **`autoPersist` reports a failed write.** It writes nothing to the console. `save.flush()` waits for the writes it started or scheduled before the call and rejects with an `AggregateError` naming the stores whose latest write failed; a failure nothing awaits is an unhandled promise rejection. A later successful write of the same store clears it.
- **Keep one `Save` per storage.** Two instances, or two browser tabs, writing the same keys are not coordinated.
- **Damaged bytes** reach `restore` and `loadSlot` as `CorruptPayloadError`; `listSlots` leaves such a slot out of the listing and leaves it in storage.
- **Saves are plain JSON** readable by anyone with access to the device's files or the browser profile. Keep credentials and tokens out of them.

## Saving when the game goes to the background

`@yagejs/save` adds no listener of its own: `autoPersist` already writes within a microtask of every change, and only the game knows what its checkpoint is. Save it from the lifecycle event:

```ts yage-group="save" yage-file="background.ts" yage-context="engine"
import { save } from "./persistence/save.js";
import { saves } from "./persistence/stores.js";

engine.events.on("host:active", ({ active }) => {
  if (!active) void save.saveSlot("saves", "auto", saves);
});
```

The operating system may end the process before that write resolves. The previous checkpoint is then still readable, and the next launch restores it with no shutdown callback.

## Moving saves to another adapter

A packaged app and a web build never share storage, so there is nothing to import unless a shipped release of the same app changes adapter. The copy runs at boot, before any save:

```ts yage-group="import"
import type { SaveAdapter } from "@yagejs/save";

const DONE = "imported";

export async function importSaves(
  from: SaveAdapter,
  to: SaveAdapter,
): Promise<void> {
  if ((await to.read(DONE)) !== null) return;
  for (const key of await from.list("")) {
    const value = await from.read(key);
    if (value !== null) await to.write(key, value);
  }
  await to.write(DONE, new Date().toISOString());
}
```

The marker holds no `/`, so it cannot collide with a key `Save` writes. Nothing is deleted from the source, so an interrupted run copies again at the next boot.

## Migration

`version` + `migrate` live on the read call (`restore` / `loadSlot`), not on the primitive. `autoPersist` takes `version` only. Per-leaf migration is not supported.

```ts yage-group="save" yage-file="migration.ts"
import { createRecord, createStore } from "@yagejs/core";
import { save } from "./persistence/save.js";
import { initialRun, type RunData } from "./persistence/stores.js";

// Single record:
const saves = createRecord<RunData>({ default: () => initialRun() });
await save.restore("saves", saves, {
  version: 3,
  migrate: (old, fromVersion) => {
    let v = old as Record<string, unknown>;
    if (fromVersion < 2) v = { ...v, inventory: [] };
    if (fromVersion < 3) v = { ...v, position: v.startPos ?? { x: 0, y: 0 } };
    return v as RunData;
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

```ts
import { beforeEach } from "vitest";
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
