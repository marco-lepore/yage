# @yagejs/save

Persistence for the [YAGE](https://yage.dev) 2D game engine — typed reactive
stores plus a snapshot path for full-scene quicksave.

## Install

```bash
npm install @yagejs/save
```

## Stores + Save instance (primary path)

Most save data is *intentional* — settings, save slots, world facts,
progression. Define typed stores at module scope, construct one `Save`
instance, register it via the plugin.

```ts
import { Engine } from "@yagejs/core";
import {
  defineStore, defineSet,
  createSave, SavePlugin, localStorageAdapter, SaveServiceKey,
} from "@yagejs/save";

interface Settings { music: number; sfx: number }

const settings = defineStore<Settings>("settings", {
  defaults: () => ({ music: 0.8, sfx: 1.0 }),
});
const opened = defineSet<string>("world.opened");

const save = createSave({ adapter: localStorageAdapter() });

await save.restoreAll([settings, opened]);
save.autoPersist(settings);

const engine = new Engine();
engine.use(new SavePlugin({ save }));
```

Save slots with typed metadata:

```ts
interface RunMeta { location: string; playtime: number }
await save.saveSlot<RunMeta>(saves, "manual-1", { metadata: { /* … */ } });
const slots = await save.listSlots<RunMeta>(saves);
await save.loadSlot(saves, "manual-1");
```

## Snapshot path (advanced)

Full-scene serialization via `@serializable` decorators. Use for quicksave
that captures every entity, component, and active process.

```ts
import { serializable } from "@yagejs/core";
import { SnapshotPlugin, SnapshotServiceKey } from "@yagejs/save";

@serializable
class Player extends Entity { /* ... */ }

engine.use(new SnapshotPlugin());
const snap = engine.context.resolve(SnapshotServiceKey);
snap.saveSnapshot("slot-1");
await snap.loadSnapshot("slot-1");
```

## What's in the box

- **Stores** — `defineStore`, `defineSet`, `defineMap`, `defineCounter`
  (re-exported from `@yagejs/core`).
- **Save** — `createSave({ adapter })` with `persist`, `restore`, `saveSlot`,
  `loadSlot`, `listSlots`, `deleteSlot`, `autoPersist`.
- **Adapters** — `localStorageAdapter`, `memoryAdapter`. Implement
  `SaveAdapter` for IndexedDB, files, cloud, etc.
- **Codecs** — `jsonCodec`, `setCodec`, `mapCodec`, `dateCodec`.
- **Snapshot system** — `SnapshotPlugin`, `SnapshotService`, `@serializable`
  decorator (in `@yagejs/core`), snapshot contributors.

## Docs

Full documentation at [yage.dev](https://yage.dev).

## License

MIT
