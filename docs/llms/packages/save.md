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

Stores are typed singletons declared at module scope. Re-exported from `@yagejs/save` for convenience; originals live in `@yagejs/core`.

```ts
import { defineStore, defineSet, defineMap, defineCounter } from "@yagejs/save";

interface SettingsData {
  audio: { music: number; sfx: number };
  vsync: boolean;
}

export const settings = defineStore<SettingsData>("settings", {
  version: 1,
  defaults: () => ({ audio: { music: 0.8, sfx: 1.0 }, vsync: true }),
});

export const saves = defineStore<RunData>("saves", {
  version: 2,
  defaults: () => ({ chapter: 1, position: { x: 0, y: 0 }, inventory: [] }),
  migrate: (old, fromVersion) => {
    if (fromVersion < 2) return { ...(old as RunData), inventory: [] };
    return old as RunData;
  },
});

export const opened   = defineSet<string>("world.opened");
export const defeated = defineMap<string, number>("world.defeated");
export const restEpoch = defineCounter("world.restEpoch");
```

Store API:

```ts
store.get(): Readonly<T>           // frozen snapshot, stable reference
store.set(partial: Partial<T>): void  // shallow merge
store.subscribe(listener): () => void
store.reset(): void                // restore defaults
```

`defineSet<K>`: `has`, `add`, `remove`, `clear`, `size`, `values`.
`defineMap<K, V>`: `has`, `get`, `set`, `remove`, `clear`, `size`, `entries`.
`defineCounter`: `value`, `set`, `increment`, `decrement`.

Store ids must be unique within a process. Defining two with the same id throws.

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
- `StoreVersionTooNewError` — stored version is greater than `defineStore`'s `version`.
- `StoreMigrationMissingError` — stored version is older and no `migrate` configured.

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

`defineSet`/`defineMap`/`defineCounter` bundle codecs internally — you only specify a codec for `defineStore<T>` when `T` contains exotic types.

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

For store id `"saves"`:

```
saves                      ← unslotted document (persist/restore)
saves:manual-1             ← slot data
saves:auto                 ← slot data
saves:__slots__            ← slot manifest (savedAt + metadata)
```

`listSlots` reads the manifest, not adapter `list()` — metadata is fast and atomic with each save.

## Migration

```ts
defineStore<RunData>("saves", {
  version: 3,
  defaults: () => initialRun(),
  migrate: (old, fromVersion) => {
    let v = old as Record<string, unknown>;
    if (fromVersion < 2) v = { ...v, inventory: [] };
    if (fromVersion < 3) v = { ...v, position: v.startPos ?? { x: 0, y: 0 } };
    return v as RunData;
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
save.loadData("bestScore");
```

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
