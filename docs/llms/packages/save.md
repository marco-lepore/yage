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

## Defining stores

Two factories: the **compound** `defineStore` (primary — collects typed leaves under one save target) and the **standalone** `defineRecord`/`defineValue`/`defineCounter`/`defineMap`/`defineSet`/`defineList` for one-offs. Re-exported from `@yagejs/save` for convenience; originals live in `@yagejs/core`.

### Compound: `defineStore(id, builder, opts?)`

```ts
import { defineStore } from "@yagejs/save";

interface Potion { name: string; quality: number }

const game = defineStore("save-stores.run", (s) => ({
  inventory:  s.map<string, number>(),
  recipes:    s.set<string>(),
  gold:       s.counter({ default: 0 }),
  reputation: s.counter({ default: 50 }),
  shelf:      s.list<Potion>(),
  day:        s.value<number>({ default: 1 }),
  settings:   s.record<{ volume: number; lang: string }>({
    defaults: () => ({ volume: 0.8, lang: "en" }),
  }),
}));

// Idiomatic per-shape ops on each leaf:
game.gold.increment(10);
game.inventory.set("moonleaf", 3);
game.recipes.add("brew-1");

// Save the whole tree as one document:
save.autoPersist(game);
```

Leaf builder methods: `s.value<T>({ default, codec? })`, `s.counter({ default? })`, `s.record<T>({ defaults, codec? })`, `s.map<K,V>({ defaults? })`, `s.set<K>({ defaults? })`, `s.list<T>({ defaults? })`.

The compound implements `PersistentLike`: one storage key per compound; `serialize()` walks all leaves; `hydrate(payload)` fans the payload out to each leaf. Per-tree `version` and `migrate(old, fromVersion)` are passed in `opts`.

Reserved leaf keys: `id`, `version`, `subscribe`, `serialize`, `hydrate`, `reset` — leaf names that collide throw at definition time.

`useStore(compound)` is intentionally **not** supported — read individual leaves so React subscription granularity stays per-leaf.

### Standalone factories (one-offs)

```ts
import {
  defineRecord, defineValue, defineCounter, defineMap, defineSet, defineList,
} from "@yagejs/save";

export const settings = defineRecord<SettingsData>("settings", {
  defaults: () => ({ audio: { music: 0.8, sfx: 1.0 }, vsync: true }),
});

export const opened   = defineSet<string>("world.opened");
export const defeated = defineMap<string, number>("world.defeated");
export const restEpoch = defineCounter("world.restEpoch");
export const day       = defineValue<number>("world.day", { defaults: () => 1 });
export const journal   = defineList<{ at: number; text: string }>("world.journal");
```

Shape APIs (each leaf also exposes `.subscribe(fn)`):

- `defineRecord<T>` / leaf `s.record`: `get(): Readonly<T>`, `set(partial: Partial<T>)`, `reset()` (standalone only).
- `defineValue<T>` / leaf `s.value`: `get(): T`, `set(v: T)`.
- `defineCounter` / leaf `s.counter`: `value()`, `set(n)`, `increment(by?)`, `decrement(by?)`, `clamp(value, min, max)`.
- `defineMap<K, V>` / leaf `s.map`: `get(k)`, `set(k, v)`, `delete(k)`, `has(k)`, `entries(): Array<[K, V]>`, `size()`, `clear()`.
- `defineSet<K>` / leaf `s.set`: `add(k)`, `delete(k)`, `has(k)`, `values(): K[]`, `size()`, `clear()`.
- `defineList<T>` / leaf `s.list`: `add(item): number` (returns id), `remove(id): boolean`, `get(id)`, `update(id, partial)`, `list(): T[]` (insertion order), `size()`, `clear()`. Ids are monotonic and stable across save/restore.

Re-defining a store with the same id silently replaces the previous registry entry — intentional so dev-server hot reloads don't throw on the second `defineX` call. Treat ids as unique within a single non-HMR runtime; collisions across modules will quietly overwrite.

### Migrating N standalone stores to one compound

```ts
// Before — three save documents, three autoPersist calls.
const progression = defineRecord<RunData>("run", { defaults: () => ({ chapter: 1, coins: 0 }) });
const deaths      = defineCounter("deaths");
const flags       = defineSet<string>("flags");
save.autoPersist(progression);
save.autoPersist(deaths);
save.autoPersist(flags);

// After — one document, one autoPersist call, atomic serialize/hydrate.
const game = defineStore("run", (s) => ({
  progression: s.record<RunData>({ defaults: () => ({ chapter: 1, coins: 0 }) }),
  deaths:      s.counter({ default: 0 }),
  flags:       s.set<string>(),
}));
save.autoPersist(game);
```

## Save instance API

```ts
// Unslotted single-document
await save.persist(store);
await save.restore(store);
await save.restoreAll([s1, s2, s3]);

// Slotted with typed metadata
interface RunMeta { location: string; playtime: number }
await save.saveSlot<RunMeta>(saves, "manual-1", {
  metadata: { location: "Forest", playtime: 60 },
});
await save.loadSlot(saves, "manual-1");
const slots = await save.listSlots<RunMeta>(saves);
// -> [{ name: "manual-1", savedAt: 1714..., metadata: {...} }, ...]
await save.deleteSlot(saves, "manual-1");

// Auto-persist — coalesces synchronous sets into one write per microtask.
// Each separate event triggers its own write. For real time-based debouncing,
// wrap the store yourself.
const stop = save.autoPersist(settings);

// Multi-profile via hierarchical slot names + prefix filter
await save.saveSlot(saves, `${profile}/manual-1`);
await save.listSlots(saves, { prefix: `${profile}/` });
```

Errors:

- `SlotNotFoundError` — `loadSlot` on a slot that doesn't exist.
- `StoreVersionTooNewError` — stored version is greater than the store's current `version`.
- `StoreMigrationMissingError` — stored version is older and no `migrate` configured.
- `InvalidKeyError` — empty store id or slot name passed to `Save` methods. Thrown synchronously before the adapter is touched.

## Boot pattern

```ts
// game/main.ts
import { settings, saves, opened, defeated } from "./persistence/stores.js";
import { save } from "./persistence/save.js";

await save.restoreAll([settings, saves, opened, defeated]);
save.autoPersist(settings);
save.autoPersist(saves);

const engine = new Engine();
engine.use(new SavePlugin({ save }));
await engine.start();
```

## Continue pattern

```ts
const slots = await save.listSlots(saves);
if (slots.length > 0) {
  const latest = slots.sort((a, b) => b.savedAt - a.savedAt)[0];
  await save.loadSlot(saves, latest.name);
}
```

## Component access

```ts
import { SaveServiceKey } from "@yagejs/save";

class CheckpointOnRest extends Component {
  setup() {
    this.entity.on(Rested, async () => {
      const save = this.use(SaveServiceKey);
      await save.saveSlot(saves, "auto");
    });
  }
}
```

## Codecs

Stores accept a `Codec<T>` for non-JSON-native value types. Built-ins:

```ts
import { jsonCodec, setCodec, mapCodec, dateCodec } from "@yagejs/save";

jsonCodec<T>()       // identity (default)
setCodec<K>()        // Set<K>     <-> K[]
mapCodec<K, V>()     // Map<K, V>  <-> [K, V][]
dateCodec()          // Date       <-> ISO string
```

`defineSet`/`defineMap`/`defineCounter`/`defineList` bundle codecs internally — you only specify a codec for `defineRecord<T>` / `defineValue<T>` (and the compound `s.record`/`s.value` leaves) when `T` contains exotic types.

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

Per-store (standalone) and per-tree (compound). Per-leaf migration is not supported in v1.

```ts
// Standalone:
defineRecord<RunData>("saves", {
  version: 3,
  defaults: () => initialRun(),
  migrate: (old, fromVersion) => {
    let v = old as Record<string, unknown>;
    if (fromVersion < 2) v = { ...v, inventory: [] };
    if (fromVersion < 3) v = { ...v, position: v.startPos ?? { x: 0, y: 0 } };
    return v as RunData;
  },
});

// Compound — migrate the whole tree at once. Returns the new-format `data`
// dict that gets dispatched to each leaf's hydrate.
defineStore("run", (s) => ({
  gold: s.counter({ default: 0 }),
  day:  s.value<number>({ default: 1 }),
}), {
  version: 2,
  migrate: (old, fromVersion) => {
    const v1 = old as { gold: number };
    return { gold: v1.gold, day: { value: 7 } };
  },
});
```

Migration runs inside `store.hydrate` when stored version < current. Future versions throw `StoreVersionTooNewError`.

## Test setup

```ts
import { _resetAllStoresForTesting } from "@yagejs/core";
import { createSave, memoryAdapter } from "@yagejs/save";

beforeEach(() => {
  _resetAllStoresForTesting();
});

const save = createSave({ adapter: memoryAdapter() });
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
