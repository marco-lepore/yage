# YAGE - Pain Points & Limitations

## Architecture & Design

**No enabled check in component lifecycle dispatch.** GameObject iterates all components on every tick without checking `component.isEnabled()` (`src/GameObject/index.ts:54-75`). Disabled components still receive lifecycle calls - it's up to each component to check its own enabled state, which most don't do consistently.

**Async `onAfterTick` via `setTimeout(..., 0)`.** Scene's `tickerCallback` (`src/Scene/index.ts:124-127`) dispatches `onAfterTick` through a `setTimeout`, making it async/deferred. This is non-obvious and could cause subtle ordering bugs where `onAfterTick` logic runs in the next microtask, not in the same frame.

**`onAfterFixedTick` called inside `onFixedTick`.** The `onFixedTick` method calls `this.onAfterFixedTick(timestepMS)` directly at the end (`src/Scene/index.ts:177`), meaning subclass overrides of `onFixedTick` that call `super.onFixedTick()` will also trigger `onAfterFixedTick` mid-execution. This couples the two lifecycle steps.

**Global mutable context via Executor.** The `Executor` is a static singleton (`src/Executor/index.ts`) that stores the "current" game and scene. It's reassigned constantly throughout the codebase (in Scene constructor, every tick callback, transitions, event dispatch). This is fragile - any async operation or multi-scene scenario could read stale context.

## Performance

**No query caching.** All `getGameObjectBy*` and `getComponentBy*` methods do full linear scans with `.find()` or `.filter()` every call (`src/Scene/index.ts:202-233`, `src/GameObject/index.ts:78-116`). The codebase even has a comment acknowledging this: `// Memoize these?` at `src/GameObject/index.ts:77`. In a scene with many objects, this is an O(n) cost on every query.

**Process mode filtering on every lifecycle hook.** Each of the 6 lifecycle hooks (`onBeforeTick`, `onTick`, `onFixedTick`, etc.) independently calls `this.gameObjects.filter(this.filterByProcessMode)` (`src/Scene/index.ts:146-187`). That's 6 full array filters per frame over all game objects, when the result only changes when `paused` state changes.

**No spatial partitioning.** There's no built-in spatial query system beyond what Rapier provides. For games needing non-physics spatial queries (proximity checks, area triggers), you'd need to build your own.

## Missing Features

**No mouse/touch/gamepad input.** `InputComponent` only handles keyboard via `game.playerInput` which only listens to `keydown`/`keyup` (`src/Game/index.ts:174-183`). There's no mouse position, click, touch, or gamepad support anywhere in the engine.

**No camera/viewport integration at the engine level.** `pixi-viewport` is a dependency but there's no built-in camera component or viewport management. Each game needs to wire this up manually.

**No audio spatialization or scene-level audio management.** `AudioComponent` is a thin wrapper around `@pixi/sound` with per-instance cache (`src/components/AudioComponent/index.ts`). There's no global audio bus, no spatial audio, and no scene-level volume/mute.

**No built-in collision event routing.** `RapierBodyComponent` has `onCollision` handlers (`src/components/RapierBodyComponent/index.ts:144-146`) and stores a mapping, but the actual Rapier event loop that would call `handleCollision` isn't wired up in the Scene's physics step. The collision infrastructure exists but appears incomplete.

**No scene stacking or layering.** Only one scene can be active at a time (`game.scene`). There's no way to overlay scenes (e.g. a HUD scene on top of a gameplay scene).

**The Node system is orphaned.** `src/nodes/Node.ts` implements a tree structure but it's not exported from `src/index.ts`, not used anywhere, and not integrated with the GameObject/Scene hierarchy. It seems like an abandoned experiment.

## Developer Experience

**No tests exist.** Vitest is configured and the `npm test` script works, but there are zero test files in the entire repository. The testing infrastructure is there, but nothing validates the engine.

**`typedoc` not installed.** The `docs` script references `typedoc` but it's not in `devDependencies`, so `npm run docs` would fail on a fresh install.

**Private `setup()`/`teardown()` pattern is confusing.** BaseComponent declares `private setup()` and `private teardown()` (`src/components/BaseComponent/index.ts:40-42`) which are called from the constructor and `destroy()`. Being private, they can't be overridden by subclasses - yet several built-in components (Game, Scene) use the same pattern with their own private versions. This creates confusion about the intended extension point (constructor vs `onAdded` vs a `setup` that can't actually be overridden).

**PixiJS v7 lock-in.** The engine is pinned to PixiJS v7 (`^7.0.4`) which is now legacy. PixiJS v8 has a significantly different API, so upgrading would require substantial refactoring across GraphicComponent, AnimatedGraphicComponent, all UI components, the Display system, and more.

**XState v4 lock-in.** Similarly, `xstate` is pinned to `^4.37.2`. XState v5 was a major rewrite with a different API. The `FSMComponent` uses v4's `interpret()` and `withContext()` patterns.

**Mixed dependency placement.** Some packages that should be devDependencies are in dependencies (e.g., `eslint-plugin-yage`, `prettier-eslint`, `vite-plugin-wasm`, `vite-plugin-top-level-await`), and `@types/lodash` is in dependencies instead of devDependencies.

## Robustness

**No error boundaries.** If any component's `onTick` throws, it crashes the entire game loop. There's no try/catch around component iteration in any of the lifecycle dispatchers.

**`destroy()` can cause double-removal.** `GameObject.destroy()` calls `this.scene.removeGameObjects(this)` (`src/GameObject/index.ts:37`), and `Scene.removeGameObjects` calls `go.destroy()` on each removed object (`src/Scene/index.ts:245`). The `destroyed` boolean flag prevents infinite recursion, but the bidirectional call is fragile.

**`preventDefault()` on all key events.** The game captures all keyboard input and calls `keyEvent.preventDefault()` on every keydown/keyup (`src/Game/index.ts:178-182`). This breaks browser shortcuts, dev tools shortcuts, and accessibility features with no way to opt out.

---

## Developer Experience - Deep Dive

### Ergonomics (from real example analysis)

**Massive physics boilerplate for every object.** Creating the simplest physics-enabled sprite requires ~12 lines of ceremony: import Rapier types, create RigidBodyDesc, create ColliderDesc, call `pu()` for coordinate conversion, add RapierBodyComponent, create a PixiJS graphic, add GraphicComponent with linkedTransform. Every single example repeats this pattern verbatim. Compare to Phaser's `this.physics.add.sprite(x, y, 'key')`. The bounce example's `Ball` class is 15 lines of constructor boilerplate for a circle that bounces.

**Physics is mandatory even when unused.** Every Scene creates a Rapier world on construction. The `input` example - which only displays text - still has to set `this.rapier.pixelToMeterRatio = 10` and `this.rapier.world.gravity = new Vector2(0, 0)` in `onLoad()`. There's no way to opt out of physics.

**InputComponent requires `Map` instead of plain object.** You must write `new Map<string, string[]>([['jump', ['Space', 'KeyW']]])` instead of just `{ jump: ['Space', 'KeyW'] }`. Every example that uses input includes this awkward construction. The Map adds type annotation noise and square-bracket nesting for zero benefit.

**Constructor-only initialization.** All game logic setup is packed into constructors. There's no declarative way to compose a GameObject - no config object, no builder pattern, no prefab template. Each new object type means a new class with the same constructor boilerplate.

**Verbose generics with no payoff.** Examples use `class Ball<ParentScene extends LevelScene> extends GameObject<ParentScene>` even when the generic is never leveraged. The type parameter cascades - if your Scene is generic, your GameObjects become generic, and then your Components. In practice most examples use `Scene<void>` or `Scene` with no state, making the generic noise pointless.

**Inconsistent Scene state initialization.** `Scene<void>` lets you call `new LevelScene()` with no args, but other examples pass `new LevelScene({})`. The `particles` and `loader` examples pass `{}` as initial state while `bounce` passes nothing. There's no guidance on which pattern to use, and TypeScript doesn't enforce consistency.

**No example discovery or runner.** The root `index.html` doesn't reference any example. Each example has its own HTML file but there's no dev menu, no URL routing, and no instructions for which file to point Vite at. Running an example requires knowing the file path.

**`pu()` conversion is a constant tax.** Every physics object must convert coordinates with `pu(x, y)`, destructure the result `const [px, py] = pu(x, y)`, and remember to use `px/py` for physics and `x/y` for rendering. Forgetting to convert is a common source of bugs. The `pixelToMeterRatio` should be handled transparently.

### Missing Abstractions

**No collision layers/masks.** Rapier supports collision groups, but YAGE provides no abstraction. The `animated-sprite` example manually sets `ActiveEvents.COLLISION_EVENTS` on each collider and checks `instanceof` in collision handlers. A layer/mask system like `physics.setCollisionGroup('player', 'enemy')` would dramatically reduce boilerplate.

**No debug rendering.** There's no way to visualize physics bodies, colliders, bounding boxes, or other debug info. Debugging physics requires adding temporary GraphicComponents that mirror collider shapes - purely manual.

**No prefab or template system.** Want to spawn 100 identical enemies? You call `instantiateGameObject(Enemy, ...)` 100 times. There's no pooling integration, no prototype cloning, no declarative prefab. The `ObjectPool` utility exists but isn't integrated with `instantiateGameObject`.

**No UI layout system.** UI components (UITextComponent, UIButtonComponent) are positioned with absolute pixel coordinates. There's no flexbox, no anchoring, no responsive layout. Building a menu means manually computing positions for every element.

**No screen shake or camera effects.** The Display extends pixi-viewport but provides no helper for common camera effects. The viewport has hardcoded 2000x2000 world dimensions.

**No entity lifecycle events for observers.** When a GameObject is added, destroyed, or changes components, there's no event emitted. Other systems can't react to these changes without polling.

### Missing Core Features

**No save/load or serialization.** There's no way to serialize game state, scene state, or entity state. No snapshot/restore for undo, replays, or persistence.

**No plugin or middleware system.** The engine can't be extended without modifying source. There's no hook system, no middleware pipeline, no plugin registration.

**No tween chaining or sequencing.** `Process.tween` returns a Process with `toPromise()`, so you can `await` it, but there's no built-in way to chain, sequence, or run tweens in parallel with a clean API. Every animation sequence is manual promise chains.

**No built-in pathfinding.** For any AI movement, you'd need to bring your own pathfinding library.

**No networking or multiplayer primitives.** No client-server sync, no authoritative physics, no state replication.

### Self-Acknowledged Issues

The dialogue example's own text says: *"It's pretty basic and a bit hard to customize, but it works (mostly)"*. The `DialogueWindow` requires a specific structure (NineSlicePlane, cursor Sprite, exact padding format) and customization means subclassing with significant override work.

The `// Memoize these?` comment on query methods (`src/GameObject/index.ts:77`) shows awareness of the performance issue without resolution.

The `collisionEmitter` in the particles example is set up but never triggered because collision event routing isn't complete - the emitter config exists, the component is created, but no collision callback actually fires it.
