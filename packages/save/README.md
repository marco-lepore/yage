# @yagejs/save

Controlled persistence for the [YAGE](https://yage.dev) 2D game engine. Save
typed reactive stores or any explicit `Serializable<TEncoded>` state root.

## Install

```bash
npm install @yagejs/save
```

## Stores + Save instance

Most save data is _intentional_ — settings, save slots, world facts,
progression. Define typed stores at module scope, construct one `Save`
instance, register it via the plugin.

```ts
import { Engine, createStore, createRecord, createSet } from "@yagejs/core";
import { createSave, SavePlugin, localStorageAdapter } from "@yagejs/save";

interface RunData {
  chapter: number;
  position: { x: number; y: number };
}

// Compound store — bundles many typed leaves into one save document.
const game = createStore((s) => ({
  run: s.record<RunData>({
    default: () => ({ chapter: 1, position: { x: 0, y: 0 } }),
  }),
  opened: s.set<string>(),
}));

// Leaf factory for one-offs (different save target — separate document).
const settings = createRecord<{ music: number; sfx: number }>({
  default: () => ({ music: 0.8, sfx: 1.0 }),
});

const save = createSave({ adapter: localStorageAdapter() });

await Promise.all([
  save.restore("saves", game),
  save.restore("settings", settings),
]);
save.autoPersist("saves", game);
save.autoPersist("settings", settings);

const engine = new Engine();
engine.use(new SavePlugin({ save }));
```

In-game components resolve the registered Save through `SaveServiceKey`:

```ts
import { SaveServiceKey } from "@yagejs/save";

class CheckpointOnRest extends Component {
  setup() {
    this.entity.on(Rested, async () => {
      const save = this.use(SaveServiceKey);
      await save.saveSlot("saves", "auto", game);
    });
  }
}
```

Save slots with typed metadata:

```ts
interface RunMeta {
  location: string;
  playtime: number;
}
await save.saveSlot<unknown, RunMeta>("saves", "manual-1", game, {
  metadata: {
    /* … */
  },
});
const slots = await save.listSlots<RunMeta>("saves");
await save.loadSlot("saves", "manual-1", game);
```

## What's in the box

- **State factories** — compound `createStore` + leaf `createRecord`, `createValue`, `createSet`, `createMap`, `createCounter`, `createList`
  (live in `@yagejs/core`).
- **Save** — `createSave({ adapter })` with `persist(id, thing)`,
  `restore(id, thing, opts?)`, `saveSlot(id, slot, thing, opts?)`,
  `loadSlot(id, slot, thing, opts?)`, `listSlots(id)`, `deleteSlot(id, slot)`,
  `autoPersist(id, thing, opts?)`.
- **Adapters** — `localStorageAdapter`, `memoryAdapter`. Implement
  `SaveAdapter` for IndexedDB, files, cloud, etc.
- **Codecs** — `jsonCodec`, `setCodec`, `mapCodec`, `dateCodec`.

## Docs

Full documentation at [yage.dev](https://yage.dev).

## License

MIT
