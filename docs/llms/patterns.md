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
    this.listenBus("entity:destroyed", ({ entity }) => {
      /* ... */
    });
  }
}
```

### Error boundary behavior

If `update()` or `fixedUpdate()` throws, the error is attributed to the component, logged, recorded (`Inspector.getErrors().callbackErrors`), and rethrown. `GameLoop.tick()` stops the loop if the error escapes the whole frame unhandled.

### Stored modes and state machines

Use `StateMachine` when a component has named modes and only specific moves
between them are valid. Keep condition checks beside the probes and inputs that
produce them, then call `go()`.

```ts
class EnemyBrain extends Component {
  readonly mode = this.stateMachine(
    defineStates({
      patrol: { to: ["windup"] },
      windup: { to: ["attack"], for: 0.2, next: "attack" },
      attack: { to: ["patrol"] },
    }),
    "patrol",
  );

  fixedUpdate(dt: number) {
    if (this.mode.is("patrol") && this.canAttack()) this.mode.go("windup");
    this.mode.tick(dt);
  }
}
```

The component's fixed-step `dt` already includes scene and entity time scaling.
Passing it to `tick()` makes timed states pause during a freeze. Call `tick()`
from `update()` for a frame-clock presentation mode. The first `tick()` runs the
initial `enter` hook; call `start()` from `onAdd` to run it earlier. State
machines do not poll conditions themselves.

A state that lists itself in `to` restarts on `go(current)`, running `exit` and
`enter` again and resetting its timer. A state that does not list itself ignores
the call.

Mark the few states the whole machine falls into with `fromAny: true` rather
than repeating them in every `to` list. Give `for` a function when the duration
comes from tuning: it runs when the state is entered, so it can read a field the
constructor assigns after the machine is built.

```ts
class EnemyBrain extends Component {
  private readonly tuning: EnemyTuning;

  readonly mode = this.stateMachine(
    defineStates({
      patrol: { to: ["windup"] },
      windup: { to: ["strike"], for: () => this.tuning.windup, next: "strike" },
      strike: { to: ["patrol"] },
      hit: { fromAny: true, to: ["patrol"] },
      die: { fromAny: true },
    }),
    "patrol",
  );

  constructor(tuning: EnemyTuning) {
    super();
    this.tuning = tuning;
  }
}
```

Ask `canGo()` before a `go()` that a late callback may no longer be allowed to
make, such as an animation finishing after the entity died.

Keep the presentation layer out of the table by listening instead of calling
into it from a hook. `machine.events` carries `changed`, `entered` and `exited`,
typed with the machine's own state names:

```ts
class EnemyView extends Component {
  private readonly anim = this.sibling(AnimationController);
  private readonly enemy = this.sibling(EnemyBrain);

  onAdd() {
    const { mode } = this.enemy;
    this.listen(mode, mode.events.entered, ({ state }) =>
      this.anim.play(state),
    );
  }
}
```

A state that holds a phase sequence declares `states` and the `start` phase.
`go()` at the parent level exits the current phase and then the parent, so a
sequence never outlives the state that holds it:

```ts
defineStates({
  idle: { to: ["shoot", "hit"] },
  shoot: {
    to: ["idle", "hit"], // reachable from every phase
    start: "aim",
    states: {
      aim: { to: ["fire"], for: 0.2, next: "fire" },
      fire: { to: ["recoil"], for: 0.1, next: "recoil" },
      recoil: { to: ["idle"], for: 0.3, next: "idle" },
    },
  },
  hit: { to: ["idle"] },
});
```

`state` reads the current phase; `is("shoot")` is true throughout the sequence.
Nesting is one level deep.

Use ordinary getters for derived or combined facts. Use one machine per
independent state axis. Use `@yagejs-addons/abilities` for actions that need
input intents, lanes, priorities, holds, or timed step windows.

## System Patterns

Systems are for engine-level cross-cutting concerns (rendering, physics, audio sync) and ship inside plugins. Game rules go in Components, never in a `System` subclass. A component that needs a live set of entities registers its own `QueryCache` query (see QueryCache below).

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

A component that registers a query unregisters it on removal, or the query keeps receiving updates:

```ts
class EnemyRadar extends Component {
  private enemies!: QueryResult;

  onAdd() {
    const cache = this.use(QueryCacheKey);
    this.enemies = cache.register([Transform, EnemyTag]);
    this.addCleanup(() => cache.unregister(this.enemies));
  }
}
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

The parent link is made when `spawnChild` returns, so a child's `setup()` reads
`this.parent` as `null`. Pass the parent as a setup param, or reserve both
entities in a `scene.spawnBatch` and call `batch.addChild` before
`batch.setup`.

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

// The rule and its state live in a component.
class Durability extends Component {
  private hp: number;

  constructor(hp: number) {
    super();
    this.hp = hp;
  }

  damage(n: number) {
    this.hp -= n;
    if (this.hp <= 0) this.entity.destroy();
  }
}

@trait(Damageable)
class Crate extends Entity {
  setup() {
    this.add(new Durability(3));
  }

  takeDamage(n: number) {
    this.get(Durability).damage(n); // the trait method hands off to the component
  }
}

// Query with type guard:
for (const e of scene.findEntities({ trait: Damageable })) {
  e.takeDamage(1); // typed
}
```

Each trait method hands the call to a component of the entity; the component holds the state and the rule.

### Blueprints (deprecated)

`defineBlueprint()` is deprecated. Existing blueprints still work, but new code uses an entity subclass with `setup()`, including for simple parametric factories (coins, bullets, platforms).

## Process Patterns

### Cooldown slot

```ts
class Weapon extends Component {
  private pc = this.sibling(ProcessComponent);
  private cooldown!: ProcessSlot;

  onAdd() {
    // slot() lives on ProcessComponent, so make sure the entity has one
    if (!this.entity.tryGet(ProcessComponent))
      this.entity.add(new ProcessComponent());
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

pc.run(seq.build());
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

Processes are updated manually via `_update(dt)` — no game loop needed. `ProcessSlot` uses `_tick(dt)`. `Sequence.build()` returns the process a test drives:

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
      .build();

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
- Processes use `_update(dt)`, `ProcessSlot` uses `_tick(dt)`, `Sequence` uses `build()` — direct control, no game loop needed.
- The ErrorBoundary records and logs a component/system throw, then rethrows it — nothing is disabled or muted. Assert on `inspector.getErrors().callbackErrors` and on the rethrow, not on `enabled`.
- Use `vi.fn()` and `vi.spyOn()` from Vitest for mocking callbacks and service methods.

## Scene Management Patterns

### Pause menu

```ts
class PauseScene extends Scene {
  readonly name = "pause";
  override readonly pauseBelow = true; // freeze scene below
  override readonly transparentBelow = true; // keep rendering below

  onEnter() {
    // Build the menu here; a Resume button calls
    // void this.use(SceneManagerKey).pop();
  }
}

// In the game scene: components reach the scene manager through DI.
class PauseOnKey extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly scenes = this.service(SceneManagerKey);

  update() {
    if (this.input.isJustPressed("pause")) {
      void this.scenes.push(new PauseScene());
    }
  }
}
```

Scene and Component code reaches the scene manager with `this.use(SceneManagerKey)` or `this.service(SceneManagerKey)`, never through a module-level `engine` variable. `engine.scenes` is for `main.ts`.

To update the game scene's HUD on pause, override the game scene's `onPause()` / `onResume()` hooks and call a HUD component method in one line: `this.findByKey<HudEntity>(HUD_KEY)?.status.setPaused(true)`. The pause scene does not touch the game scene.

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
// cannot be per-entity time-scaled. Persist entity.timeScale explicitly when
// it is durable game state.
```

An entity excluded from a slow-motion effect still has its body integrated at
the slowed rate. Scale velocity writes by the ratio of the two rates:

```ts
const world = time.effectiveScale;
const factor = world > 0 ? time.effectiveScaleForUpdates(entity) / world : 1;
rb.setVelocity(dir.scale(speed * factor));
```

The factor is `1` while the scene is frozen — nothing integrates then.

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
// (a pause menu does not consume a hitstop). Requests release on scene exit;
// re-issue them when rebuilding a scene from saved domain state.
```

### Cross-scene access

```ts
const DifficultyChanged = defineEvent<{ level: number }>("settings:difficulty");

// In a scene or component of the options scene on top:
const game = this.use(SceneManagerKey).all.find((s) => s.name === "game");
if (game) game.timeScale = 0.25; // Scene's own API, no cast
game?.emit(DifficultyChanged, { level: 2 }); // components there hear it with listenScene
```

Don't cast a scene to its subclass to read its fields: game state lives in components, reached with `findByKey`. Game events are `defineEvent` tokens emitted on a scene or entity; the engine `EventBus` carries engine events only and does not take tokens.

## State Management Patterns

Game state (score, lives, inventory, a level clock) lives in a component on a host entity. Reach it with `spawn(Class, { key })` + `scene.findByKey`, a query, or the reference `spawn()` returned. Where it does not go:

- Not a module-level `let` (`let score = 0`): never reset on restart, breaks scene isolation and tests.
- Not a field on the `Scene` subclass changed from `onEnter` closures: the rules end up in the scene, and readers have to cast `this.scene`.
- Not a `ServiceKey` (`context.register`, `scene.registerScoped`): service keys are for plugin-owned infrastructure only (renderer, physics world, input manager).

Module-level `createStore` / `createRecord` is only for state that `@yagejs/save` persists (see "Saved state" below).

### Game state on a host entity

```tsx
// constants.ts
export const CoinCollected = defineEvent("coin:collected");
export const PlayerDied = defineEvent("player:died");
export const HUD_KEY = "hud"; // spawn key, for scene.findByKey

// hud.ts
export class RunProgress extends Component {
  private readonly label: UIText;
  private _coins = 0;
  private _lives = 3;

  constructor(label: UIText) {
    super();
    this.label = label;
  }

  get coins(): number {
    return this._coins;
  }

  get lives(): number {
    return this._lives;
  }

  onAdd(): void {
    this.refresh();
    // Coins and hazards emit on themselves; the events bubble to the scene.
    this.listenScene(CoinCollected, () => {
      this._coins += 1;
      this.refresh();
    });
    this.listenScene(PlayerDied, () => {
      this._lives = Math.max(0, this._lives - 1);
      this.refresh();
    });
  }

  private refresh(): void {
    this.label.setText(`Coins ${this._coins}   Lives ${this._lives}`);
  }
}

export class HudEntity extends Entity {
  progress!: RunProgress; // the run's state, hosted on this entity

  setup(): void {
    const panel = this.add(
      new UISurface({ anchor: Anchor.TopRight, offset: { x: -16, y: 16 } }),
    );
    const label = panel.text("", { fontSize: 20, fill: 0xffe66d });
    this.progress = this.add(new RunProgress(label));
  }
}

// scene.ts — onEnter only spawns
class LevelScene extends Scene {
  readonly name = "level";
  onEnter(): void {
    this.spawn(HudEntity, { key: HUD_KEY });
    this.spawn(PlayerEntity);
  }
}

// Any component in the scene reads it:
const coins = this.scene.findByKey<HudEntity>(HUD_KEY)?.progress.coins ?? 0;

// React reads it (selector polled each frame, re-renders on change):
function CoinCounter() {
  const coins = useSceneSelector(
    (scene) => scene.findByKey<HudEntity>(HUD_KEY)?.progress.coins ?? 0,
  );
  return <Text>{`Coins: ${coins}`}</Text>;
}
```

- The state resets with the scene: the host is destroyed on exit and spawned again by the next `onEnter`. No reset code.
- Emitters (`this.entity.emit(CoinCollected)` in a coin's trigger) know nothing about the score. Only `RunProgress` changes it.
- The Inspector reports component getters, so e2e tests read `coins` / `lives`.
- `onEnter` may connect an event to a component method in one line (`this.on(PlayerHit, () => player.get(Health).damage(1))`), with no state or rules in the scene. Prefer the component listening for itself with `listenScene`.
- Reference: `examples/src/platformer/hud.ts` (`RunProgress` on `HudEntity`, keeps coin count and win state); playable at https://examples.yage.dev/platformer.html.

### Saved state (module-level store)

```ts
import { createStore } from "@yagejs/core";
import { useStore } from "@yagejs/ui-react";

// Module scope is right for saved state: @yagejs/save restores it before
// the scene that reads it is entered.
export const records = createStore((s) => ({
  bestCoins: s.counter({ default: 0 }),
  unlocked: s.set<string>(),
}));

save.autoPersist("records", records); // ids at the call site; see packages/save.md

// A component writes when its rule says so:
if (this._coins > records.bestCoins.value()) records.bestCoins.set(this._coins);

// React reads (re-renders on change):
const best = useStore(records.bestCoins);
```

## Common Game Patterns

### Spawning an entity type

An entity type is an `Entity` subclass with `setup(params)`; its rules go in components. `defineBlueprint` is deprecated (see "Blueprints (deprecated)" above). A named spawn (`scene.spawn("background")`) is only for a one-off entity with no behaviour of its own: a UI root, a background, a HUD host.

```ts
class Coin extends Entity {
  setup({ x, y }: { x: number; y: number }) {
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({
        shape: { type: "circle", radius: 10 },
        sensor: true,
      }),
    );
    this.add(new CoinPickup()); // the pickup rule lives in a component
  }
}
scene.spawn(Coin, { x: 200, y: 300 });
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
// Sensors are skipped by default, so a trigger zone underfoot is not ground.
const hit = world.raycast(position, Vec2.DOWN, halfHeight + 2);

// Coyote time is a ProcessSlot on the physics clock, not a number counted
// down by hand. In onAdd:
//   this.coyote = this.processes.slot({ duration: 0.1, clock: "fixed" });
// In fixedUpdate: restart it on every grounded step; it closes by itself.
if (hit) this.coyote.restart();
const canJump = this.coyote.running;
```

## Common Gotchas

**setup() vs constructor**: Entity constructors run before the entity is attached to the scene. Always use `setup()` for adding components and resolving services.

**Deferred destruction**: `entity.destroy()` deactivates immediately — `isActive` reads `false`, the entity leaves every query, `onDisable` fires right away. `onDestroy` and detaching from the scene wait for the EndOfFrame flush, so don't assume the entity or its components are gone until then.

A destroyed child keeps its slot in its parent's child map until that same flush, so its name is still taken for the rest of the tick. `addChild` and `spawnChild` both throw on a name the parent already holds, so a replacement under the same name in the same tick fails. `parent.removeChild(name)` detaches the child and frees the name in the same tick, so call it before the replacement spawns. A pooled child is the exception: `destroy()` hands it back to its pool, which detaches it there and then, so its name is free straight away.

```ts
const old = parent.removeChild("view"); // name free from here on
old.destroy();
parent.spawnChild("view", NextView);
```

**Fixed vs variable dt**: `update(dt)` receives variable frame delta. `fixedUpdate(dt)` receives the fixed timestep. Use `fixedUpdate` for physics-sensitive logic.

**Vec2 is immutable**: `vec.add(other)` returns a new Vec2. Transform has mutating methods (`setPosition`, `translate`).

**Pixels everywhere**: All user-facing APIs work in pixels. Physics coordinate conversion is internal.

**Component uniqueness**: One component per _exact_ class per entity. `entity.add()` throws if that class already exists. A base class and a subclass of it are different classes, so both can sit on one entity — `entity.getAll(Base)` lists them, while `entity.get(Base)` throws because there is no single answer.

**No pixi.js in core**: `@yagejs/core` has zero runtime dependencies. Never import pixi.js in core code.

**Clean up DOM listeners**: Use `this.listen()` for entity/scene events (auto-cleanup on removal). If you must use raw DOM listeners (e.g. wheel events), store the handler and remove it in `onDestroy()`. Never add bare `window.addEventListener()` calls without corresponding removal.
