# @yagejs/core

ECS, math, events, and scheduling - the foundation of the [YAGE](https://yage.dev) 2D game engine.

## Install

```bash
npm install @yagejs/core
```

## What's in the box

- **Engine** - the game loop and plugin host
- **Scene / SceneManager** - scene stack with push/pop, pause, and time scaling
- **Entity / Component** - ECS primitives with typed queries
- **Transform / Vec2** - 2D math and spatial positioning
- **EventBus** - typed, decoupled events with `defineEvent`
- **Blueprint / Trait** - composition helpers
- **Process / Tween / Sequence** - timers, easing, and keyframe animation
- **AssetManager** - async resource loading
- **Inspector** - snapshot introspection for tests and debug tools

## Usage

```ts
import { Engine, Scene, Entity, Component, Transform, Vec2 } from "@yagejs/core";

class Player extends Entity {
  setup() {
    this.add(new Transform({ position: new Vec2(100, 100) }));
  }
}

class GameScene extends Scene {
  readonly name = "game";

  onEnter() {
    this.spawn(Player);
  }
}

const engine = new Engine();
await engine.start();
engine.scenes.push(new GameScene());
```

`@yagejs/core` has zero runtime dependencies. On its own it's a pure ECS - add `@yagejs/renderer` to draw things, `@yagejs/physics` for collisions, `@yagejs/input` for controls, etc.

## Docs

Full documentation at [yage.dev](https://yage.dev).

## License

MIT
