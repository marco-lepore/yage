# @yagejs/core

ECS, math, events, and scheduling - the foundation of the [YAGE](https://yage.dev) 2D game engine.

## Install

```bash
npm install @yagejs/core
```

## What's in the box

- **Engine** - the game loop and plugin host
- **Scene / SceneManager** - scene stack with push/pop, pause, and time scaling
- **Entity / Component** - ECS primitives with typed queries; an entity type is an `Entity` subclass with `setup()`, and components hold the game logic
- **Transform / Vec2** - 2D math and spatial positioning
- **Events** - typed entity and scene events with `defineEvent`, plus the engine `EventBus` for engine events
- **Trait** - capabilities an entity subclass declares and code can query at runtime
- **Blueprint** - deprecated; use an `Entity` subclass
- **Process / Tween / Sequence** - timers, easing, and keyframe animation
- **AssetManager** - async resource loading
- **Inspector** - snapshot introspection for tests and debug tools

## Usage

```ts
import {
  Engine,
  Scene,
  Entity,
  Component,
  Transform,
  Vec2,
} from "@yagejs/core";

// Game logic lives in components.
class Drift extends Component {
  private readonly transform = this.sibling(Transform);

  update(dt: number) {
    this.transform.translate(50 * dt, 0); // 50 px per second
  }
}

// An entity type is an Entity subclass that adds its components in setup().
class Player extends Entity {
  setup() {
    this.add(new Transform({ position: new Vec2(100, 100) }));
    this.add(new Drift());
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
