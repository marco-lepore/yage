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

Or `createGame({ save: true })`.

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
