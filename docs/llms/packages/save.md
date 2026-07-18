# @yagejs/save

Depends on `@yagejs/core`. Persistence for YAGE — two paths:

1. **Stores + Save instance** (primary). Typed reactive stores for settings, save slots, world facts, progression. Most games need only this.
2. **Snapshot system** (advanced). Full-scene serialization via `@serializable` for quicksave-style "pause and resume the simulator." See bottom of file.

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

```ts
import {
  createStore, createRecord, createValue, createCounter,
  createMap, createSet, createList,
} from "@yagejs/core";

interface Potion { name: string; quality: number }

// Compound — bundle leaves so they serialise/restore atomically.
const game = createStore((s) => ({
  inventory:  s.map<string, number>(),
  recipes:    s.set<string>(),
  gold:       s.counter({ default: 0 }),
  reputation: s.counter({ default: 50 }),
  shelf:      s.list<Potion>(),
  day:        s.value<number>({ default: 1 }),
  settings:   s.record<{ volume: number; lang: string }>({
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
export const opened   = createSet<string>();
export const defeated = createMap<string, number>();
```

Leaf builder methods on the compound: `s.value<T>({ default, codec? })`, `s.counter({ default? })`, `s.record<T>({ default, codec? })`, `s.map<K,V>({ default? })`, `s.set<K>({ default? })`, `s.list<T>({ default? })`. Reserved leaf keys: `subscribe`, `serialize`, `hydrate`, `reset` — collisions throw at construction.

Shape APIs (every leaf also exposes `subscribe(fn)`, `serialize()`, `hydrate(raw)`, `reset()`):

- `createRecord<T>` / `s.record`: `get(): Readonly<T>`, `set(partial: Partial<T>)`.
- `createValue<T>` / `s.value`: `get(): T`, `set(v: T)`.
- `createCounter` / `s.counter`: `value()`, `set(n)`, `increment(by?)`, `decrement(by?)`, `clamp(value, min, max)`.
- `createMap<K, V>` / `s.map`: `get(k)`, `set(k, v)`, `delete(k)`, `has(k)`, `entries()`, `size()`, `clear()`.
- `createSet<K>` / `s.set`: `add(k)`, `delete(k)`, `has(k)`, `values()`, `size()`, `clear()`.
- `createList<T>` / `s.list`: `add(item): number` (returns id), `remove(id): boolean`, `get(id)`, `update(id, partial)`, `list()` (insertion order), `size()`, `clear()`. Ids are monotonic and stable across save/restore.

### Migrating N leaf factories to one compound

```ts
// Before — three save documents, three autoPersist calls.
const progression = createRecord<RunData>({ default: () => ({ chapter: 1, coins: 0 }) });
const deaths      = createCounter();
const flags       = createSet<string>();
save.autoPersist("run.progression", progression);
save.autoPersist("run.deaths", deaths);
save.autoPersist("run.flags", flags);

// After — one document, one autoPersist call, atomic serialize/hydrate.
const game = createStore((s) => ({
  progression: s.record<RunData>({ default: () => ({ chapter: 1, coins: 0 }) }),
  deaths:      s.counter({ default: 0 }),
  flags:       s.set<string>(),
}));
save.autoPersist("run", game);
```

## Save instance API

All methods take `(id, thing, opts?)`. `thing` is any `Serializable<T>`; the id and optional version live at the call site.

```ts
// Unslotted single-document
await save.persist("settings", settings);
await save.restore("settings", settings);
await Promise.all([save.restore("a", a), save.restore("b", b)]);

// Slotted with typed metadata
interface RunMeta { location: string; playtime: number }
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

```ts
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

```ts
const slots = await save.listSlots("saves");
if (slots.length > 0) {
  const latest = slots.sort((a, b) => b.savedAt - a.savedAt)[0];
  await save.loadSlot("saves", latest.name, saves);
}
```

## Component access

```ts
import { SaveServiceKey } from "@yagejs/save";

class CheckpointOnRest extends Component {
  setup() {
    this.entity.on(Rested, async () => {
      const save = this.use(SaveServiceKey);
      await save.saveSlot("saves", "auto", saves);
    });
  }
}
```

## Codecs

Stores accept a `Codec<T, TEncoded>` for non-JSON-native value types. `TEncoded` defaults to `T` for identity codecs and surfaces in `serialize()`/`hydrate()` and `RestoreOptions.migrate` so migrations get the right type. Built-ins live in `@yagejs/core`:

```ts
import { jsonCodec, setCodec, mapCodec, dateCodec } from "@yagejs/core";

jsonCodec<T>()       // Codec<T, T>            — identity (default)
setCodec<K>()        // Codec<Set<K>, K[]>
mapCodec<K, V>()     // Codec<Map<K,V>, [K,V][]>
dateCodec()          // Codec<Date, string>    — ISO string
```

`createSet`/`createMap`/`createCounter`/`createList` bundle codecs internally — you only specify a codec for `createRecord<T>` / `createValue<T>` (and the compound `s.record`/`s.value` leaves) when `T` contains exotic types. When a custom codec changes the encoded shape (e.g. `Date → string`), declare both generics: `createValue<Date, string>({ default: () => new Date(), codec: dateCodec() })`.

## Adapters

```ts
import { localStorageAdapter, memoryAdapter } from "@yagejs/save";

localStorageAdapter({ namespace?: string })  // browser; namespaces every key
memoryAdapter()                              // in-memory; tests + Node
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
  day:  s.value<number>({ default: 1 }),
}));
await save.restore("run", game, {
  version: 2,
  migrate: (old) => {
    const v1 = old as { gold: number };
    return { gold: v1.gold, day: { value: 7 } };
  },
});
```

Future versions throw `StoreVersionTooNewError` on read.

## Test setup

```ts
import { createSave, memoryAdapter } from "@yagejs/save";
import { createRecord } from "@yagejs/core";

const save = createSave({ adapter: memoryAdapter() });

beforeEach(() => {
  // No registry to reset — construct fresh primitives per test.
});
```

## Per-frame updates: don't

Stores are for *intentional* state — settings, slots, world facts, progression. They notify all subscribers synchronously on every change, and UI bindings re-render. **Don't update stores from `update(dt)` or other per-frame paths**; that's what ECS state and `useQuery`/`useSceneSelector` are for. If you find yourself debouncing every set, you're using the wrong primitive.

---

# Snapshot path (advanced)

Full-scene serialization via `@serializable` decorators. Use when you need quicksave/quickload of the running simulator (every entity, component, active process, scene stack). For settings, save slots, and progression, prefer the store path above.

## Snapshot setup

```ts
import { SnapshotPlugin } from "@yagejs/save";

engine.use(new SnapshotPlugin({
  namespace: "my-game",     // localStorage key prefix (default "yage")
  storage: myStorage,       // custom SnapshotStorage (default localStorage)
}));
```

## Bundler setup

`@yagejs/save` relies on TypeScript's `@serializable` class decorator and looks up classes by `class.name` at restore time. On Vite 8+ this requires two extra flags in your `vite.config.ts`:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  oxc: {
    decorator: { legacy: true },
  },
  build: {
    rollupOptions: { output: { keepNames: true } },
  },
});
```

`oxc.decorator.legacy: true` rewrites `@serializable class Foo` as a stage-2 decorator call. `output.keepNames: true` preserves class names through the oxc minifier so the registry key stored in a snapshot still matches the runtime class.

These flags are only required for user code that uses `@serializable` directly. `@yagejs/*` packages are pre-compiled and unaffected.

## @serializable

```ts
import { serializable } from "@yagejs/core";

@serializable
class Player extends Entity { }

@serializable
class GameScene extends Scene { }
```

Built-in serializable components: `Transform`, `RigidBodyComponent`, `ColliderComponent`, `SpriteComponent`, `GraphicsComponent`.

## Custom serialization

```ts
@serializable
class MovingSpike extends Component {
  serialize() {
    return { startY: this.startY, speed: this.speed, elapsed: this.elapsed };
  }
  static fromSnapshot(data: { startY: number; speed: number; elapsed: number }) {
    const spike = new MovingSpike({ startY: data.startY, speed: data.speed });
    spike.elapsed = data.elapsed;
    return spike;
  }
}
```

## Restore order

On load, each entity's components are re-added in ascending `static restorePriority` (declared on the component class; undeclared = 100, and the engine reserves 0-99). Engine bands: `Transform` 0, `RigidBodyComponent` 10, `ColliderComponent` 20, visual components 30, `AnimationController` 40, `SoundComponent`/`ParticleEmitterComponent`/`TilemapComponent` 50 — so engine components exist before an undeclared game component's `onAdd()` runs. Ties restore in save-time add order. A game component whose `onAdd()` reads a sibling declares a number above that sibling's:

```ts
@serializable
class HealthBar extends Component {
  static restorePriority = 110; // after the default band (100)
  onAdd() {
    this.entity.get(HealthComponent); // safe: restored earlier
  }
}
```

## afterRestore hooks

Re-create non-serializable state (draw callbacks, event listeners):

```ts
afterRestore(): void {
  this.get(GraphicsComponent).draw(drawFn);
  this.setupTrigger(this.get(ColliderComponent));
}
```

Pattern: extract shared setup into a method called by both `onEnter()` and `afterRestore()`.

## SnapshotService

```ts
import { SnapshotServiceKey } from "@yagejs/save";

const save = this.use(SnapshotServiceKey);

save.saveSnapshot("slot1");
await save.loadSnapshot("slot1");
save.hasSnapshot("slot1");
save.deleteSnapshot("slot1");

const data = save.exportSnapshot("slot1");   // GameSnapshot | null
await save.importSnapshot("slot1", data);

// Generic key/value blobs alongside snapshots — use the store path for new code.
save.saveData("bestScore", { value: 9999 });
save.loadData("bestScore");                  // T | null
save.hasData("bestScore");                   // boolean
save.deleteData("bestScore");
save.exportData("bestScore");                // alias for loadData (external use)
save.importData("bestScore", { value: 1 }); // alias for saveData (external use)

// Contributor management
save.registerSnapshotExtra("myPlugin", contributor);
save.unregisterSnapshotExtra("myPlugin");
```

`loadSnapshot` calls `popAll()` then pushes a fresh scene rebuilt from the snapshot — `this` (and any handles a Scene method captured before the await) refer to a destroyed shell after the promise resolves. If you need to act on the post-load scene, capture `SceneManagerKey` BEFORE the await and read `sceneManager.active` after:

```ts
async doLoad(): Promise<void> {
  const save = this.context.resolve(SnapshotServiceKey);
  const sceneManager = this.context.resolve(SceneManagerKey);
  await save.loadSnapshot("slot1");
  const active = sceneManager.active;
  if (active instanceof MyScene) active.syncUIToRestoredState();
}
```

Same caveat for any caller-side handle captured before save — the `EffectHandle` / `MaskHandle` you got from `.fx.addEffect(...)` is dead after load. Re-acquire via `findEffect(definition)` on the new scene's `tree` (renderer-contributed effects are restored by name + options).

## Snapshot schema

```ts
interface GameSnapshot {
  version: number;
  timestamp: number;
  scenes: SceneSnapshotEntry[];
  extras?: Record<string, unknown>;  // plugin-contributed extras
}

interface SceneSnapshotEntry {
  type: string;
  paused: boolean;
  entities: EntitySnapshotEntry[];
  userData?: unknown;
}

interface EntitySnapshotEntry {
  id: number;
  type: string;
  components: ComponentSnapshot[];
  userData?: unknown;
  parentId?: number;
  childName?: string;
}

interface ComponentSnapshot {
  type: string;
  data: unknown;
}
```

`SnapshotResolver.entity(oldId)` consults `EntitySnapshotEntry.id` inside `afterRestore()` hooks to rewire cross-entity references.

## SnapshotStorage

```ts
interface SnapshotStorage {
  load(key: string): string | null;
  save(key: string, data: string): void;
  delete(key: string): void;
  list(prefix?: string): string[];
}
```

Default: `LocalStorageSnapshotStorage`. (Distinct from the store path's async `SaveAdapter`.)

## Snapshot contributors

Plugins that own state outside the entity/component model:

```ts
import { SnapshotServiceKey, type SnapshotContributor } from "@yagejs/save";

const svc = context.tryResolve(SnapshotServiceKey);
svc?.registerSnapshotExtra("myPlugin", {
  serialize: () => ({ ... }),
  restore: (data) => { /* apply data */ },
});
```

Every registered contributor is invoked on `loadSnapshot`, even when the snapshot has no matching entry — `restore(undefined)` is called, and the contributor is expected to reset to baseline. A failing contributor is logged and the load continues.

The renderer plugin auto-registers a contributor under `"renderer"` for layer/scene/screen-scope effects + masks.

`GameSnapshot.version` is `4`; older saves error at load with a version mismatch.
