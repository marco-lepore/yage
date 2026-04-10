# @yage/save

Depends on `@yage/core`. Save/load with auto-serialization.

## Setup

```ts
import { SavePlugin } from "@yage/save";

engine.use(new SavePlugin({
  namespace: "my-game",     // localStorage key prefix (default "yage")
  storage: myStorage,       // custom SaveStorage implementation (default localStorage)
}));
```

## Bundler Setup

`@yage/save` relies on TypeScript's `@serializable` class decorator and looks up classes by `class.name` at restore time. On Vite 8+ this requires two extra flags in your `vite.config.ts`:

```ts
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  oxc: {
    decorator: {
      legacy: true, // transform TypeScript decorator syntax
    },
  },
  build: {
    rollupOptions: {
      output: {
        keepNames: true, // preserve class names through minification
      },
    },
  },
});
```

`oxc.decorator.legacy: true` — Vite 8's oxc transformer only implements TypeScript's stage-2 (legacy) decorator transform. Stage-3 decorators are passed through raw, and browsers can't parse `@serializable class Foo` natively. The `legacy` flag tells oxc to rewrite it as `Foo = _decorate([serializable], Foo)` at build time. The name "legacy" is historical — this is the decorator flavor used by ~every TS decorator-based framework (Angular, NestJS, TypeORM, MobX) and is not deprecated.

`output.keepNames: true` — oxc's minifier mangles class and function names by default. `@serializable` reads `class.name` to compute the registry key, so without `keepNames` the type string stored in a snapshot (e.g. `"Player"`) won't match the mangled runtime name (e.g. `"t"`), and `afterRestore()` silently fails to reconstruct entities. Enabling `keepNames` preserves the original names across the oxc minifier.

These flags are only required for user code that uses `@serializable` directly. `@yage/*` packages are pre-compiled by tsup/esbuild (which already handles decorators) and are unaffected by your Vite config.

## @serializable

Mark classes for save/load. Works on Entity, Scene, and Component subclasses.

```ts
import { serializable } from "@yage/core";

@serializable
class Player extends Entity { }

@serializable
class GameScene extends Scene { }
```

Built-in serializable components: `Transform`, `RigidBodyComponent`, `ColliderComponent`, `SpriteComponent`, `GraphicsComponent`.

## Custom Serialization

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

## afterRestore Hooks

Re-create non-serializable state (draw callbacks, event listeners):

```ts
// Entity
afterRestore(): void {
  this.get(GraphicsComponent).draw(drawFn);
  this.setupTrigger(this.get(ColliderComponent));
}

// Scene
afterRestore(): void {
  this.on(CoinCollected, () => { /* ... */ });
}
```

Pattern: extract shared setup into a method called by both `onEnter()` and `afterRestore()`.

## SaveService

```ts
import { SaveServiceKey } from "@yage/save";

const save = this.use(SaveServiceKey);

// Snapshots
save.saveSnapshot("slot1");
await save.loadSnapshot("slot1");
save.hasSnapshot("slot1");
save.deleteSnapshot("slot1");

// Export/import (for cloud saves)
const data = save.exportSnapshot("slot1");   // GameSnapshot | null
await save.importSnapshot("slot1", data);

// Persistent user data (survives snapshot deletion)
save.saveData("bestScore", { value: 9999 });
save.loadData("bestScore");                  // { value: 9999 } | null
save.hasData("bestScore");
save.deleteData("bestScore");
```

## Snapshot Schema

`exportSnapshot()` returns a `GameSnapshot` — a plain object you can serialize to JSON, ship to a cloud backend, or inspect for custom migrations. You normally interact with it only through `save.importSnapshot()`, but understanding the shape is useful when writing migration logic or debugging stale save data:

```ts
interface GameSnapshot {
  version: number;              // schema version — bump when formats change
  timestamp: number;            // Date.now() at save time
  scenes: SceneSnapshotEntry[];
}

interface SceneSnapshotEntry {
  type: string;                 // class name from @serializable
  paused: boolean;              // was the scene paused at save time
  entities: EntitySnapshotEntry[];
  userData?: unknown;           // result of scene.serialize()
}

interface EntitySnapshotEntry {
  id: number;                   // save-time ID, used to rewire cross-entity refs
  type: string;                 // class name from @serializable
  components: ComponentSnapshot[];
  userData?: unknown;           // result of entity.serialize()
  parentId?: number;            // if this is a child of another entity
  childName?: string;           // name under which parent registered this child
}

interface ComponentSnapshot {
  type: string;                 // component class name
  data: unknown;                // result of component.serialize()
}
```

The `id` field on `EntitySnapshotEntry` is what `SnapshotResolver.entity(oldId)` consults inside `afterRestore()` hooks to resolve references that pointed at other entities before the save.

## SaveStorage Interface

```ts
interface SaveStorage {
  load(key: string): string | null;
  save(key: string, data: string): void;
  delete(key: string): void;
  list(prefix?: string): string[];
}
```

Default: `LocalStorageSaveStorage`.

## Typed Slots

`SaveService` is generic over a slot-key map, so persistent user data (not snapshots) can be typed. Pass your slot shape when resolving the service to get autocomplete and type-checked `saveData`/`loadData` calls:

```ts
import { SaveServiceKey, type SaveService } from "@yage/save";

interface MySlots {
  bestScore: { value: number };
  playerName: string;
  settings: { volume: number; muted: boolean };
}

const save = this.use(SaveServiceKey) as SaveService<MySlots>;

save.saveData("bestScore", { value: 9999 });  // typed
const name = save.loadData("playerName");     // string | null
```

Untyped usage falls back to `SaveService<UntypedSlots>` (`Record<string, any>`), which is what `this.use(SaveServiceKey)` gives you by default.
