# YAGE Patterns

## Component Patterns

### Service and sibling resolution

```ts
class PlayerController extends Component {
  // Lazy proxy -- safe at field-declaration time, resolves on first access
  private input = this.service(InputManagerKey);

  // For physics entities — always go through the rigid body
  private rb = this.sibling(RigidBodyComponent);

  // Camera is an entity — pass it as a constructor parameter if needed
  constructor(private readonly camera?: CameraEntity) {
    super();
  }

  update(_dt: number) {
    const dir = this.input.getVector("left", "right", "up", "down");
    const speed = 200 / (this.camera?.zoom ?? 1);
    this.rb.setVelocity(dir.scale(speed));
    // For non-physics entities, use: this.entity.get(Transform).translate(dir.scale(200 * dt)); // dt is seconds
  }
}
```

### Event subscriptions with auto-cleanup

```ts
class DamageReceiver extends Component {
  onAdd() {
    // Auto-unsubscribes when component is removed/destroyed
    this.listen(this.entity, HitEvent, ({ damage }) => {
      this.health -= damage;
    });
    this.listenScene(SpawnEvent, (data, entity) => {
      /* ... */
    });
  }
}
```

### Error boundary behavior

If `update()` or `fixedUpdate()` throws, the error is attributed to the component, logged, recorded (`Inspector.getErrors().callbackErrors`), and rethrown. `GameLoop.tick()` stops the loop if the error escapes the whole frame unhandled.

## System Patterns

Systems are for engine-level cross-cutting concerns (rendering, physics, audio sync). Game developers typically write Components instead. Use Systems when you need efficient cross-entity iteration via `QueryCache` and strict phase ordering.

### Writing a System

```ts
import {
  System,
  Phase,
  QueryCacheKey,
  Transform,
  type EngineContext,
  type QueryResult,
} from "@yagejs/core";

class DisplaySyncSystem extends System {
  readonly phase = Phase.Render; // which frame phase to run in
  readonly priority = 0; // lower = earlier within the phase (default: 0)

  private bodies!: QueryResult;

  onRegister(context: EngineContext) {
    // Register queries for efficient entity iteration
    const cache = this.use(QueryCacheKey);
    this.bodies = cache.register([Transform, SpriteComponent]);
  }

  update(dt: number) {
    // Called once per frame (or per fixed step for FixedUpdate systems)
    for (const entity of this.bodies) {
      const transform = entity.get(Transform);
      const sprite = entity.get(SpriteComponent);
      sprite.pixiSprite.position.set(
        transform.position.x,
        transform.position.y,
      );
    }
  }

  onUnregister() {
    // Cleanup when system is removed
  }
}
```

**Phase choices:**

| Phase         | Use for                                    |
| ------------- | ------------------------------------------ |
| `EarlyUpdate` | Input polling, pre-frame setup             |
| `FixedUpdate` | Physics stepping, deterministic simulation |
| `Update`      | General game logic, AI, camera follow      |
| `LateUpdate`  | UI layout, post-logic adjustments          |
| `Render`      | Display object sync, draw calls            |
| `EndOfFrame`  | Cleanup, deferred operations               |

**Priority within a phase**: lower number runs earlier. The built-in `ComponentUpdateSystem` and `ComponentFixedUpdateSystem` use priority `1000`, so plugin systems at priority `0` run first (e.g. physics step before game logic sees results).

### QueryCache

Register a query once, get a live result set that updates automatically as components are added/removed.

```ts
import { QueryCacheKey, Transform } from "@yagejs/core";

// In a System's onRegister:
const cache = this.use(QueryCacheKey);
const enemies = cache.register([Transform, EnemyTag]);

// In update:
for (const entity of enemies) {
  const t = entity.get(Transform);
  // ...
}

enemies.size; // current count
enemies.first; // first match or undefined
enemies.toArray(); // snapshot as array (allocates)
```

## Entity Patterns

### Subclass with setup()

`setup()` runs after the entity is added to the scene. Services and `onAdd` hooks work inside it. The constructor does not have scene access.

```ts
class Enemy extends Entity {
  setup({ type, pos }: { type: string; pos: Vec2 }) {
    this.add(new Transform({ position: pos }));
    this.add(new SpriteComponent({ texture: `${type}.png` }));
    this.add(new EnemyAI(type));
  }
}

scene.spawn(Enemy, { type: "goblin", pos: new Vec2(100, 200) });
```

### Child entities for independent parts

`spawnChild()` spawns an entity and attaches it under this one in a single
call. The child keeps its own `Transform`, so it can rotate or move
independently while still following the parent. Use it when one object needs a
separately-transformed part — a turret barrel that aims while the base stays
put.

```ts
class Turret extends Entity {
  private barrel!: Entity;

  setup() {
    this.add(new Transform());
    this.add(new SpriteComponent({ texture: "turret-base.png" }));

    // Barrel is a child entity — its Transform rotates independent of the base.
    this.barrel = this.spawnChild("barrel");
    this.barrel.add(new Transform({ position: new Vec2(0, -8) }));
    this.barrel.add(new SpriteComponent({ texture: "turret-barrel.png" }));
  }

  aimAt(angle: number) {
    this.barrel.get(Transform).setRotation(angle); // base stays upright
  }
}
```

### Traits for polymorphic behavior

```ts
const Damageable = defineTrait<{ takeDamage(n: number): void }>("Damageable");

@trait(Damageable)
class Crate extends Entity {
  private hp = 3;
  takeDamage(n: number) {
    this.hp -= n;
    if (this.hp <= 0) this.destroy();
  }
  setup() {
    /* ... */
  }
}

// Query with type guard:
for (const e of scene.findEntities({ trait: Damageable })) {
  e.takeDamage(1); // typed
}
```

### Blueprints (deprecated)

`defineBlueprint()` still works for simple parametric factories (coins, bullets, platforms) but entity subclasses with `setup()` are preferred for anything that needs methods, internal state, or traits.

## Process Patterns

### Cooldown slot

```ts
class Weapon extends Component {
  private pc = this.sibling(ProcessComponent);
  private cooldown!: ProcessSlot;

  onAdd() {
    // slot() lives on ProcessComponent, so make sure the entity has one
    if (!this.entity.tryGet(ProcessComponent)) this.entity.add(new ProcessComponent());
    this.cooldown = this.pc.slot({ duration: 0.5 });
  }

  fire() {
    if (!this.cooldown.completed) return; // still cooling down
    this.cooldown.start();
    this.spawnBullet();
  }
}
```

### Sequence for cutscenes

```ts
const bossT = boss.get(Transform);
const seq = new Sequence()
  .call(() => ui.showDialogue("Watch out!"))
  .wait(2)
  .then(
    Tween.vec2(
      (v) => bossT.setPosition(v.x, v.y),
      bossT.position,
      new Vec2(bossT.position.x, 100),
      0.8,
      easeOutQuad,
    ),
  )
  .call(() => ui.hideDialogue())
  .then(Tween.custom((v) => (camera.zoom = v), 1, 1.5, 0.5));

pc.run(seq.start());
```

### Tween animation

```ts
// Rotate over time. Tween.to only accepts a plain Record<string, number>
// target, so a Transform (a class instance) uses Tween.custom with a setter.
pc.run(
  Tween.custom((v) => transform.setRotation(v), 0, Math.PI, 0.5, easeInOutQuad),
);

// Custom setter
pc.run(Tween.custom((v) => (sprite.alpha = v), 1, 0, 0.3));

// Vec2 tween
pc.run(
  Tween.vec2(
    (v) => transform.setPosition(v.x, v.y),
    Vec2.ZERO,
    new Vec2(200, 100),
    0.6,
    easeOutBounce,
  ),
);
```

### Process.delay for one-shots

```ts
pc.run(Process.delay(1, () => entity.destroy()));
```

## Testing Patterns

All test utilities are exported from `@yagejs/core`. Tests run in Vitest (Node.js, no browser needed). Co-locate tests next to source: `Foo.ts` → `Foo.test.ts` in the same directory.

```ts
import {
  createTestEngine, // fully wired Engine (async)
  createMockScene, // lightweight Scene + EngineContext
  createMockEntity, // entity in a mock scene with full context
  advanceFrames, // tick the game loop N times
} from "@yagejs/core";
```

### Unit testing a component

Use `createMockEntity` for isolated component tests — no Engine overhead, but full context access:

```ts
import { describe, it, expect } from "vitest";
import { createMockEntity, Transform, Component } from "@yagejs/core";

class Gravity extends Component {
  fixedUpdate(dt: number) {
    const t = this.entity.get(Transform);
    t.translate(0, 9.8 * dt); // dt is seconds
  }
}

describe("Gravity", () => {
  it("moves entity downward each fixed step", () => {
    const { entity } = createMockEntity("ball");
    entity.add(new Transform());
    const gravity = new Gravity();
    entity.add(gravity);

    gravity.fixedUpdate(16);

    const pos = entity.get(Transform).position;
    expect(pos.y).toBeGreaterThan(0);
  });

  it("does nothing when disabled", () => {
    const { entity } = createMockEntity("ball");
    entity.add(new Transform());
    const gravity = new Gravity();
    gravity.enabled = false;
    entity.add(gravity);

    gravity.fixedUpdate(16);

    expect(entity.get(Transform).position.y).toBe(0);
  });
});
```

### Unit testing a system

Use `createMockScene` to set up a system without a full Engine:

```ts
import { describe, it, expect } from "vitest";
import { createMockScene, SceneManagerKey, Phase, System } from "@yagejs/core";

class CountSystem extends System {
  readonly phase = Phase.Update;
  count = 0;
  update() {
    this.count++;
  }
}

describe("CountSystem", () => {
  function setup() {
    const { scene, context } = createMockScene();
    // Systems need SceneManager — mock it
    const sceneManager = {
      get active() {
        return scene;
      },
    };
    context.register(SceneManagerKey, sceneManager as never);

    const sys = new CountSystem();
    sys._setContext(context);
    sys.onRegister?.(context);
    return { sys, scene, context };
  }

  it("increments count each update", () => {
    const { sys } = setup();
    sys.update(16);
    sys.update(16);
    expect(sys.count).toBe(2);
  });
});
```

### Integration testing with the Engine

Use `createTestEngine` + `advanceFrames` for full integration tests:

```ts
import { describe, it, expect } from "vitest";
import {
  createTestEngine,
  advanceFrames,
  Scene,
  Component,
  Transform,
} from "@yagejs/core";

class GameScene extends Scene {
  readonly name = "game";
}

class Mover extends Component {
  update(dt: number) {
    this.entity.get(Transform).translate(1, 0);
  }
}

describe("Movement integration", () => {
  it("entity moves over multiple frames", async () => {
    const engine = await createTestEngine();
    const scene = new GameScene();
    await engine.scenes.push(scene); // async: preload, then onEnter

    const entity = scene.spawn("player");
    entity.add(new Transform());
    entity.add(new Mover());

    advanceFrames(engine, 10);

    expect(entity.get(Transform).position.x).toBe(10);
    engine.destroy();
  });
});
```

### Testing processes, slots, and tweens

Processes are updated manually via `_update(dt)` — no game loop needed. `ProcessSlot` uses `_tick(dt)`. `Sequence` uses `_build()` in tests instead of `start()`:

```ts
import { describe, it, expect, vi } from "vitest";
import { Tween, Sequence, ProcessSlot, easeLinear } from "@yagejs/core";

describe("Tween", () => {
  it("tweens a value over duration", () => {
    const obj = { x: 0 };
    const proc = Tween.to(obj, "x", 100, 1, easeLinear);

    proc._update(0.5);
    expect(obj.x).toBeCloseTo(50);

    proc._update(0.5);
    expect(obj.x).toBeCloseTo(100);
    expect(proc.completed).toBe(true);
  });
});

describe("ProcessSlot", () => {
  it("acts as a cooldown timer", () => {
    const slot = new ProcessSlot({ duration: 0.3 });
    expect(slot.completed).toBe(true); // starts completed (ready)

    slot.start();
    expect(slot.completed).toBe(false);

    slot._tick(0.3);
    expect(slot.completed).toBe(true); // cooldown done
  });

  it("calls cleanup on cancel and restart", () => {
    const cleanup = vi.fn();
    const slot = new ProcessSlot({ duration: 0.1, cleanup });
    slot.start();
    slot.restart(); // cleanup called, then restarted
    expect(cleanup).toHaveBeenCalledOnce();
  });
});

describe("Sequence", () => {
  it("runs steps in order", () => {
    const order: string[] = [];
    const seq = new Sequence()
      .call(() => order.push("a"))
      .call(() => order.push("b"))
      ._build();

    seq._update(16);
    seq._update(16);
    expect(order).toEqual(["a", "b"]);
  });
});
```

### Testing a plugin

```ts
import { describe, it, expect } from "vitest";
import { Engine, ServiceKey, type Plugin } from "@yagejs/core";

class FooService {
  value = 42;
}
const FooKey = new ServiceKey<FooService>("foo");

const FooPlugin: Plugin = {
  name: "foo",
  version: "1.0.0",
  install(context) {
    context.register(FooKey, new FooService());
  },
};

describe("FooPlugin", () => {
  it("registers FooService in context", async () => {
    const engine = new Engine();
    engine.use(FooPlugin);
    await engine.start();

    expect(engine.context.resolve(FooKey).value).toBe(42);
    engine.destroy();
  });
});
```

### Testing tips

- Use `createMockEntity` for component unit tests — fast, no Engine overhead.
- Use `createTestEngine` + `advanceFrames` for integration tests involving the game loop.
- Call `engine.destroy()` at the end of every integration test to clean up.
- Processes use `_update(dt)`, `ProcessSlot` uses `_tick(dt)`, `Sequence` uses `_build()` — direct control, no game loop needed.
- The ErrorBoundary records and logs a component/system throw, then rethrows it — nothing is disabled or muted. Assert on `inspector.getErrors().callbackErrors` and on the rethrow, not on `enabled`.
- Use `vi.fn()` and `vi.spyOn()` from Vitest for mocking callbacks and service methods.

## Scene Management Patterns

### Pause menu

```ts
class PauseScene extends Scene {
  override readonly pauseBelow = true; // freeze scene below
  override readonly transparentBelow = true; // keep rendering below

  onEnter() {
    // Push: engine.scenes.push(new PauseScene());
    // Resume: engine.scenes.pop();
  }
}
```

### Time scale

```ts
scene.timeScale = 0.25; // slow-mo (persistent option)
scene.timeScale = 2; // fast-forward

// Per-entity multiplier, composes on top of the scene's effective scale.
// Components receive dt * effectiveScale(entity) * entity.timeScale, where
// effectiveScale = scene.timeScale x active SceneTime requests (below).
entity.timeScale = 0; // freeze one entity while the scene runs
entity.timeScale = 2; // ...or speed it up

// Affects: component update/fixedUpdate, the entity's ProcessComponent
// (tweens), and its particle emitters. NOT physics — the scene shares one
// Rapier world stepped under the scene's effective scale only; a rigid body
// cannot be per-entity time-scaled. entity.timeScale is saved/restored.
```

### Hitstop, slow motion, bullet time, freeze frames (SceneTime)

```ts
import { SceneTimeKey } from "@yagejs/core";

// Per-scene service; arbitrates competing time effects so callers never
// write scene.timeScale directly (two writers lose the restore value).
const time = this.use(SceneTimeKey); // Component or Scene; scene-scoped key

time.freezeFor(0.08); // hitstop / freeze frame: x0 for 80ms real time
const slow = time.scaleBy(0.25, { key: "slowmo" }); // bullet time until released
slow.release(); // handles are idempotent; { active } reads state
time.scaleBy(2, { for: 5, key: "haste" }); // speed-up, auto-releases after 5s

// Exclude entities from a slow — their updates, processes, and particle
// emitters keep full speed. Their physics bodies do NOT (shared world).
time.scaleBy(0.25, { key: "slowmo", excludeUpdates: [player] });

// Freeze scene physics while a presentation host keeps updating.
time.freezeFor(0.08, { excludeUpdates: [feedbackHost] });

// Target-only requests affect updates, processes, and particles, not physics.
time.scaleEntityBy(enemy, 0.25, { for: 0.4, key: "stagger" });
time.freezeEntityFor(enemy, 0.08, { key: "stagger" });

// Composition: each `key` is a channel. Within a channel the latest active
// request wins; older still-active ones apply again when it ends. Across
// channels, winners multiply. Freeze is a x0 factor. scene.timeScale is
// input-only: effectiveScale = scene.timeScale x channel winners.
time.effectiveScale; // what physics and scene-pool processes run at
time.isFrozen; // effectiveScale === 0
time.effectiveScaleForUpdates(entity); // exclusions + target requests, pre-entity.timeScale
time.elapsed; // simulation seconds on the rendered frame
time.fixedElapsed; // simulation seconds on the fixed timestep — stamp/compare from fixedUpdate

// Durations age on raw frame time but hold while the scene is stack-paused
// (a pause menu does not consume a hitstop). Requests release on scene exit
// and are not saved — re-issue after loading a snapshot.
```

### Cross-scene access

```ts
const game = engine.scenes.all.find((s) => s.name === "game") as GameScene;
game.timeScale = 0.25;
```

## State Management Patterns

Do not use module-level `let` variables for game state (e.g. `let score = 0`). Module-level state breaks save/load, prevents scene isolation, and cannot be reset on restart. Use `ServiceKey` + DI registration or `createRecord()` instead.

### DI service for game state

```ts
const GameStateKey = new ServiceKey<GameState>("gameState");
this.context.register(GameStateKey, { score: 0, health: 100 });
// Access: this.use(GameStateKey).score
```

### Reactive store (for React UI)

```ts
import { createRecord } from "@yagejs/core";
import { useStore } from "@yagejs/ui-react";

const store = createRecord({ default: () => ({ score: 0 }) });
store.set({ score: 10 }); // ECS writes
const score = useStore(store, (src) => src.get().score); // React reads (selector takes source)
```

### Event-driven state

```ts
const CoinCollected = defineEvent("coin:collected");
this.on(CoinCollected, () => {
  state.score += 10;
});
entity.emit(CoinCollected); // from trigger handler
```

## Common Game Patterns

### Blueprints for spawning

```ts
const CoinBP = defineBlueprint<{ x: number; y: number }>(
  "coin",
  (entity, { x, y }) => {
    entity.add(new Transform({ position: new Vec2(x, y) }));
    entity.add(
      new ColliderComponent({
        shape: { type: "circle", radius: 10 },
        sensor: true,
      }),
    );
  },
);
scene.spawn(CoinBP, { x: 200, y: 300 });
```

### Health/damage

```ts
class HealthComponent extends Component {
  hp: number;
  constructor(public readonly maxHp: number) {
    super();
    this.hp = maxHp;
  }
  takeDamage(n: number) {
    this.hp = Math.max(0, this.hp - n);
    if (this.hp <= 0) this.entity.emit(EntityDied);
  }
}
```

### Ground detection (raycast)

```ts
const hit = world.raycast(position, { x: 0, y: 1 }, halfHeight + 2);
const grounded = hit !== null; // add coyote timer for better feel
```

## Common Gotchas

**setup() vs constructor**: Entity constructors run before the entity is attached to the scene. Always use `setup()` for adding components and resolving services.

**Deferred destruction**: `entity.destroy()` deactivates immediately — `isActive` reads `false`, the entity leaves every query, `onDisable` fires right away. `onDestroy` and detaching from the scene wait for the EndOfFrame flush, so don't assume the entity or its components are gone until then.

**Fixed vs variable dt**: `update(dt)` receives variable frame delta. `fixedUpdate(dt)` receives the fixed timestep. Use `fixedUpdate` for physics-sensitive logic.

**Vec2 is immutable**: `vec.add(other)` returns a new Vec2. Transform has mutating methods (`setPosition`, `translate`).

**Pixels everywhere**: All user-facing APIs work in pixels. Physics coordinate conversion is internal.

**Component uniqueness**: One component per class per entity. `entity.add()` throws if the class already exists.

**No pixi.js in core**: `@yagejs/core` has zero runtime dependencies. Never import pixi.js in core code.

**Clean up DOM listeners**: Use `this.listen()` for entity/scene events (auto-cleanup on removal). If you must use raw DOM listeners (e.g. wheel events), store the handler and remove it in `onDestroy()`. Never add bare `window.addEventListener()` calls without corresponding removal.
