# Agent Guide

This is a [YAGE](https://yage.dev) 2D game engine project (TypeScript + Vite).

## Run locally

- `npm install`
- `npm run dev` — start Vite dev server on http://localhost:5173
- `npm run build` — production build to `dist/`
- `npm run preview` — preview the production build

## What's in the starter

The starter installs `@yagejs/core` and `@yagejs/renderer` only. It contains
one scene that spawns a placeholder rectangle. `src/main.ts` has commented-out
blocks that register `@yagejs/physics`, `@yagejs/input`, `@yagejs/audio`, and
`@yagejs/debug`. Uncomment the blocks you need, and run the install command
listed above each block.

## Project layout

```
src/
├── main.ts               # Engine boot, plugins, scene push
├── scenes/
│   └── MainScene.ts      # spawns the entities; edit this to build your game
└── entities/
    └── Placeholder.ts    # the placeholder rectangle, an Entity subclass
```

Add folders as your project grows. The suggested structure:

```
src/
├── main.ts
├── scenes/             # one file per scene
├── entities/           # entity subclasses (simple: single file; complex: folder)
└── components/         # components shared across multiple entities
```

See https://yage.dev/patterns/project-layout for the full conventions.
**Short version:**

- One scene per file.
- A simple entity is a single file. A complex entity is a folder with an
  `index.ts`.
- Entity-specific components live next to their entity. Use `components/` only
  for components shared across entities.
- Keep `main.ts` short.

## Writing game code

Follow these rules for every entity, component, and scene you add.

- **An entity type is an `Entity` subclass.** Its `setup(params)` adds the
  entity's components. Spawn it with `this.spawn(Coin, { x, y })`, and YAGE
  calls `setup(params)`. A function that builds and returns an entity should be
  a subclass instead. Spawn by name (`this.spawn("background")`) only for a
  one-off entity with no behaviour of its own, such as a background or a UI
  root.
- **Components hold the game logic.** Rules go in a component's `update(dt)`
  or `fixedUpdate(dt)`, its event handlers, and its methods. Systems are for
  engine internals only.
- **A component listens for events itself.** Declare an event with
  `defineEvent` and emit it on the entity (`this.entity.emit(CoinCollected)`).
  Entity events bubble to the scene. Listen with
  `this.listen(entity, CoinCollected, fn)` for one entity, or
  `this.listenScene(CoinCollected, fn)` for the event from any entity in the
  scene. Both unsubscribe when the component is removed.
- **`onEnter` assembles the scene.** It spawns entities, sets up the camera,
  and starts music. It holds no game state and no rules.
- **Game state lives in a component on a host entity.** Put the score, lives,
  or a run timer in a component. Spawn its entity with a key, and reach it
  with `scene.findByKey`, a query, or the reference `spawn()` returns:

  ```ts
  class Score extends Component {
    value = 0;

    onAdd(): void {
      this.listenScene(CoinCollected, () => {
        this.value += 1;
      });
    }
  }

  class Hud extends Entity {
    score!: Score;

    setup(): void {
      this.score = this.add(new Score());
    }
  }

  // In onEnter:
  this.spawn(Hud, { key: "hud" });
  // In any component:
  const coins = this.scene.findByKey<Hud>("hud")?.score.value;
  ```

  Do not keep game state in a module-level variable, a field on the `Scene`,
  or a `ServiceKey` service. A module-level store (`createStore`,
  `createRecord`) is only for state that `@yagejs/save` persists.

- **Time comes from the engine.** `dt` and every duration are in seconds. A
  cooldown or a time window is a slot on the entity's `ProcessComponent`:

  ```ts
  class Dash extends Component {
    private readonly processes = this.sibling(ProcessComponent);
    private cooldown!: ProcessSlot;

    onAdd(): void {
      this.cooldown = this.processes.slot({ duration: 0.8 });
    }

    tryDash(): void {
      if (this.cooldown.running) return;
      this.cooldown.restart();
      // ...move the entity
    }
  }
  ```

  A one-off delay is `this.processes.run(Process.delay(0.5, fn))`. Do not use
  `setTimeout` or `setInterval`: they keep running while the game is paused
  and ignore the time scale.

- **Randomness comes from the scene.** `this.use(RandomKey)` returns the
  scene's `RandomService`, with `float()`, `range(min, max)`,
  `int(min, max)`, `pick(array)`, and `shuffle(array)`. Do not use
  `Math.random`. `window.__yage__.inspector.setSeed(1)` seeds every scene's
  generator, so a test run is reproducible.
- Resolve engine services with `this.service(Key)` or `this.use(Key)` inside
  components, never through a module-level `engine` variable.

## Key conventions

- `Vec2` is immutable — operations return new instances
- `Transform` is mutable — mutate in place for performance
- Pixels are the primary unit across every public API

## Save state

Use `@yagejs/save` with an explicit `Serializable<TEncoded>` state root. Save
files contain only the state you choose. YAGE does not serialize the live ECS
world automatically.

## Full YAGE documentation

- Short index: https://yage.dev/llms.txt
- Full reference (for long LLM contexts): https://yage.dev/llms-full.txt
- Getting started tutorial: https://yage.dev/getting-started/your-first-game
- Project layout conventions: https://yage.dev/patterns/project-layout
- GitHub: https://github.com/marco-lepore/yage
