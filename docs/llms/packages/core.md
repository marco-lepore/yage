# @yagejs/core

Zero runtime dependencies. ECS foundation, DI, game loop, scenes, events, processes.

## Key Exports

### Architecture

| Export | Purpose |
|---|---|
| `Engine` | Entry point; plugin orchestration, game loop, scene manager |
| `EngineContext` | DI container |
| `ServiceKey<T>` | Typed DI key |
| `Scene` | Abstract scene base class |
| `SceneManager` | Stack-based scene management (push/pop/replace) |
| `Entity` | Named component container |
| `EntityPool` | Reuses entities instead of spawning and destroying them; grows on demand unless capped |
| `EntityHandle<T>` | Reference to one life of an entity; reads `undefined` once that life ends |
| `Component` | Base class for game logic |
| `System` | Base class for engine-level systems |
| `Phase` | Enum: EarlyUpdate, FixedUpdate, Update, LateUpdate, Render, EndOfFrame |

### Entity

```ts
class Entity {
  readonly name: string;
  readonly key?: string;                      // stable identity (opt-in)
  get scene(): Scene;                         // throws if detached
  get tryScene(): Scene | null;               // null if detached
  get activeSelf(): boolean;                  // own bit
  get isActive(): boolean;                    // own bit AND every ancestor's
  get generation(): number;                   // which life; moves on when one ends
  setActive(active: boolean): void;
  handle(): EntityHandle<this>;               // reference that expires with this life
  requireKey(): string;                       // throws if no key
  addChild(name: string, child: Entity): void;
  spawnChild(name: string, options?: SpawnOptions): Entity;
  // Trailing args derived from the entity's setup() signature.
  spawnChild<E extends Entity>(
    name: string,
    Class: new () => E,
    ...rest: ClassSpawnArgs<E>
  ): E;
  spawnChild<P>(
    name: string,
    blueprint: Blueprint<P>,
    params: P,
    options?: SpawnOptions,
  ): Entity;
}
```

- `entity.scene` throws with a clear error when the entity is detached (not yet spawned, or already destroyed — both the end-of-frame flush and scene teardown clear it). Prefer it in user code — throwing beats letting a `null` propagate silently. Use `entity.tryScene` only in defensive paths (e.g. systems iterating query results during teardown) where detachment is expected.
- `entity.isDestroyed` is true after `destroy()` and for entities torn down with their scene on exit. Teardown also emits `entity:destroyed` once per entity, so listeners tracking entity lifetimes are notified of every destruction, including destruction caused by scene exit.
- `entity.spawnChild(name, Class, params?)` combines `scene.spawn(...)` + `this.addChild(name, ...)`. Child is auto-added to the parent's scene. Use for sub-entities owned by a parent (enemy body + health bar, player + weapon, etc.).

### Activeness

`setActive(false)` turns an entity off without destroying it — the cheap way to recycle a bullet, a hit spark, or an enemy instead of respawning one.

```ts
bullet.setActive(false);                   // hidden, physics body off, updates skipped
// ...later
bullet.get(Transform).setPosition(x, y);
bullet.setActive(true);                    // back in play, nothing reallocated
```

- Move a `RigidBodyComponent` entity with `rb.setPosition(x, y)`, not a direct `Transform` write: physics owns the transform of a dynamic body and overwrites the write on the next frame.

- `activeSelf` is the entity's own bit; `isActive` is that bit AND every ancestor's. Deactivating a parent puts the whole subtree to sleep, and each descendant keeps its own `activeSelf` for when the parent wakes.
- A dormant entity drops out of every `QueryCache` query, and out of `scene.findEntity`, `scene.findEntitiesByTag`, `scene.findEntities`, and `filterEntities`. `scene.getEntities()` still returns it, so save and teardown see it. `scene.findByKey` also still returns it — key lookup is identity, not a search.
- Components keep their own `enabled` flags. A component you disabled by hand is still disabled after the entity comes back.
- Adding a component to a dormant entity runs `onAdd()` but not `onEnable()`, and the entity joins no queries until it is activated.
- A dormant entity's components and its `ProcessComponent` stop being ticked, so tweens and coroutines pause where they are and resume on reactivation.
- Reuse resets nothing: `entity.timeScale`, animation position, process progress, entity event listeners and addon state all survive. Register listeners in `setup()`, and reset game state yourself when you bring an entity back.

### Component enable/disable hooks

`onEnable()` / `onDisable()` fire when a component's *effective* enabled-ness — `component.enabled && entity.isActive` — changes. `component.effectiveEnabled` reads that state.

```ts
class Turret extends Component {
  private beam?: SoundHandle;
  onEnable() { this.beam = this.use(AudioManagerKey).play("hum", { loop: true }); }
  onDisable() { this.beam?.stop(); }
}
```

- Order on add: `onAdd()`, then query join, then `onEnable()`. Order on remove or destroy: `onDisable()`, then cleanups, then `onRemove()` / `onDestroy()`.
- Validate dependencies by throwing from `onAdd()`. The throw is attributed to the component, recorded in `Inspector.getErrors().callbackErrors`, and rethrown to the caller of `entity.add()`. Called from `setup()`, that caller is `scene.spawn`, which destroys the half-built entity and its children before rethrowing.
- `onEnable()` sees whatever state the component held while dormant. Put live resources there (sounds, bodies, display objects), not game-state resets.
- Writing `component.enabled` fires the hooks too, so a component disabled by hand releases its resources the same way.
- A throwing hook is attributed to its component and rethrown, like a throwing `update()`. A throw from `onDisable()` during scene teardown stops teardown at that entity.

Engine implementations: a dormant rigid body and collider leave the simulation but keep their allocation, which is what makes reuse cheap; the body's velocity, forces, and torques are cleared on disable, so it comes back at rest. The renderer's visual components, `UISurface`, `ParticleEmitterComponent`, and `TilemapComponent` hide their display object. `SoundComponent` stops playback and does not resume on its own.

Gotcha: a collider disabled and re-enabled while it still overlaps something gets no new collision-start. A reused entity dropped onto an existing contact receives no `onCollision` for it.

### EntityPool

A group of entities cycled by deactivation rather than spawn and destroy. A member is built once and reused, so its Rapier body, Pixi display object and component instances stay allocated between lives.

```ts
class Bullet extends Entity {
  setup() { /* Transform, GraphicsComponent, RigidBodyComponent, collider */ }
  // Required for a pooled class. Its parameters become acquire()'s arguments.
  onAcquire(x: number, y: number, dir: Vec2) {
    const rb = this.get(RigidBodyComponent);
    rb.setPosition(x, y);
    rb.setVelocity({ x: dir.x * 900, y: dir.y * 900 });
  }
  onRelease() { this.target = undefined; }   // optional, game-level cleanup
}

// In onEnter — members' components resolve scene services during setup().
this.bullets = new EntityPool(this, Bullet, { prewarm: 32 });

const bullet = this.bullets.acquire(x, y, dir);   // Bullet
this.bullets.release(bullet);
```

```ts
class EntityPool<T extends PoolableEntity, TMax extends number | undefined = undefined> {
  // Third argument carries { setup } when the class's setup() requires params.
  constructor(scene: Scene, Class: new () => T, options?: EntityPoolOptions<T, TMax>);
  get size(): number;        // total members
  get leased(): number;      // handed out
  get free(): number;        // available
  acquire(...args: Parameters<T["onAcquire"]>): T | undefined;  // T when elastic
  forceAcquire(...args: Parameters<T["onAcquire"]>): T;
  release(member: T): void;
  releaseAll(): void;
  dispose(): void;           // destroys members; the scene does this on exit
}

interface EntityPoolOptions<T, TMax> {
  prewarm?: number;                       // built up front, parked dormant
  maxSize?: TMax;                         // total members; unset = elastic
  reclaimPriority?: (member: T) => number; // lowest is reclaimed first
}
```

- Elastic by default: `acquire` grows the pool and returns `T`. With `maxSize`, a saturated `acquire` returns `undefined` and the return type widens to `T | undefined`.
- A capped pool assigned to an unannotated `const` keeps the literal cap in its type (`EntityPool<Bullet, 32>`), which does not assign to `EntityPool<Bullet, number>`. Annotate the field or variable and the cap infers as `number`.
- `forceAcquire` always returns a member. On a saturated capped pool it reclaims the lowest `reclaimPriority` (default: acquired longest ago), running `onRelease` then `onAcquire` in the same call.
- `onAcquire` is required on a pooled class — an inherited one counts. It must be synchronous and non-overloaded, since `acquire`'s signature is derived from it. Declare an empty `onAcquire() {}` when there is nothing to reset.
- Prewarm builds members and runs `setup()`, never `onAcquire`.
- The member is active, in its queries, and past `onEnable` before `onAcquire` runs. Acquire during Update and it renders the same frame; acquire in Render or EndOfFrame and it first draws on the next one.
- Nothing else resets: position, health, animation frame, `timeScale`, processes, and entity listeners all survive a cycle. Reset them in `onAcquire`, and register listeners in `setup()` or drop them in `onRelease`.
- Bookkeeping completes before the hooks run. A throwing `onAcquire` leaves the member leased and active; a throwing `onRelease` still parks it. Both throws are attributed to the entity and propagate.
- Releasing an entity the pool has not leased — a double release, another pool's member — is a reported no-op. `setActive` called from outside does not change who holds the lease.
- Pools belong to their scene and are disposed on exit; `acquire` on a disposed pool throws. Build them in `onEnter()`, where scene services exist.
- The pool owns its members' lifetimes. `entity.destroy()` on a member releases it back to the pool instead of tearing it down, so retire sites holding a plain `Entity` (collision handlers, `update`, event listeners) need no pool reference and the same code works pooled or not. `isDestroyed` stays `false` for such a member; destroying an entity with a member below it detaches and returns that member. Only `dispose()` destroys members.
- Save snapshots skip members and everything parented under one. A pool restores empty and refills, so entities in flight at save time are gone on load.
- A released member is alive and `isDestroyed` is `false`, so a stored reference to one silently follows the entity into its next life. Store `entity.handle()` instead when something else owns the release.
- The physics collision drain captures both sides of every pair before running any handler, so a pair naming an entity a handler released is dropped instead of reaching whoever acquired it next.

### Entity handles

`entity.handle()` returns an `EntityHandle<T>`: a reference that stops resolving when that entity's life ends. Read it through `.current`.

```ts
class Turret extends Entity {
  private target?: EntityHandle<Enemy>;

  onSpotted(enemy: Enemy) { this.target = enemy.handle(); }

  update() {
    const enemy = this.target?.current;   // undefined once that enemy is gone
    if (enemy) this.aimAt(enemy);
  }
}
```

```ts
interface EntityHandle<out T extends Entity = Entity> {
  readonly current: T | undefined;
}
```

- Rule of thumb: use a handle whenever pooled entities are involved — a member can be retired from anywhere (`destroy()` in its own collision handler releases it), so a stored plain reference goes stale silently. A plain reference is fine for entities that live as long as the scene, or when the code storing the reference also controls when the entity goes away.
- `.current` means "same life", not "currently active": an entity turned off with `setActive(false)` still resolves.
- A life ends on `destroy()`, on scene teardown, on every path that ends a member's lease — `release`, `releaseAll`, a `forceAcquire` reclaim — and on `dispose()`, which destroys the members outright. A member's children end their lives with it, so a handle on a pooled entity's hitbox expires too.
- `entity.generation` is the counter behind it: 0 for a fresh entity, increased whenever a life ends. Compare it for equality — a destruction cascade can advance it more than once, so it does not count lives. Public read, engine write. It is not saved and not in the Inspector snapshot.
- `handle()` on a pool member the pool is not currently lending out returns a handle that never resolves, and warns in dev builds. The caller is holding a stale reference, so a handle from it would come alive at the next acquisition.
- Handles are created by `entity.handle()` only; `EntityHandle` is a type, not a constructor. `T` is output-only, so an `EntityHandle<Enemy>` is assignable to `EntityHandle<Entity>` and not the other way round.

### Events

| Export | Purpose |
|---|---|
| `EventBus<E>` | Typed pub/sub (`on`, `once`, `emit`, `clear`) |
| `EventToken<T>` | Typed token for entity events |
| `defineEvent<T>(name)` | Create an event token |

`EngineEvents` (the typed map used by `EventBusKey`):

| Event | Payload |
|---|---|
| `entity:created` / `entity:destroyed` | `{ entity }` — `entity:destroyed` fires on the end-of-frame flush after `destroy()` and once per entity on scene teardown, before `scene:popped`/`scene:replaced` |
| `component:added` | `{ entity; component }` |
| `component:removed` | `{ entity; componentClass }` |
| `scene:pushed` / `scene:popped` | `{ scene }` |
| `scene:replaced` | `{ oldScene; newScene }` |
| `scene:transition:started` / `scene:transition:ended` | `{ kind; fromScene; toScene }` |
| `scene:loading:progress` | `{ scene; ratio }` |
| `scene:loading:done` | `{ scene }` |
| `engine:started` / `engine:stopped` | `undefined` |
| `screen:fullscreen` | `{ active: boolean }` — emitted by `RendererPlugin` on `fullscreenchange` / `webkitfullscreenchange` |
| `screen:orientation` | `{ type: OrientationType }` — emitted by `RendererPlugin` on `screen.orientation.change` (or `orientationchange` fallback) |

### Scene Events

`Scene.on(token, handler)` subscribes to a typed event at the scene level. Handlers fire for **both** scene-emitted events (`scene.emit(token, data)`) and entity events that bubble up (`entity.emit(token, data)`). The handler signature distinguishes the two via an optional second arg:

```ts
import { defineEvent, type Entity } from "@yagejs/core";

const DamagedEvent = defineEvent<{ amount: number }>("damaged");

// Inside a scene:
scene.on(DamagedEvent, (data: { amount: number }, entity?: Entity) => {
  if (entity) {
    // bubbled — `entity` is the source that called entity.emit(DamagedEvent, ...)
    console.log(`${entity.name} took ${data.amount}`);
  } else {
    // scene-emitted via scene.emit(DamagedEvent, ...)
    console.log(`scene-wide damage event: ${data.amount}`);
  }
});

scene.emit(DamagedEvent, { amount: 5 });          // handler runs with entity = undefined
someEntity.emit(DamagedEvent, { amount: 10 });    // handler runs with entity = someEntity
```

`Scene.on` returns an unsubscribe function. The handler param is `(data, entity?)` regardless of which side emitted — game code should check `entity` to decide whether to read source state.

`Scene.registerScoped<T>(key: ServiceKey<T>, value: T)` (public) attaches a scene-scoped service resolvable via `Component.use(key)`, and via `Scene.use(key)` / `Scene.service(key)` from the scene itself. Both are scope-aware: scene scope first, then engine. Plugins call it from `beforeEnter`; game code can call it from `onEnter` for scene-local state. Every key registered this way is auto-unregistered on scene exit (after `onExit` and plugin `afterExit` hooks), so scenes don't leak services into one another. `Scene.tryResolveScoped<T>(key)` (public) reads a scene-scoped service without engine-scope fallback, returning `undefined` when absent. Use it in systems that iterate scenes. `_registerScoped` / `_resolveScoped` are kept internal aliases — prefer the public names in new code.

### SceneTime — hitstop, slow motion, bullet time, freeze frames

Per-scene arbitration for competing time effects. The engine registers one instance per scene under the scene-scoped `SceneTimeKey`; resolve via `Component.use(SceneTimeKey)` / `Scene.use(SceneTimeKey)`, or `scene.tryResolveScoped(SceneTimeKey)` from a System.

| Member | Purpose |
|---|---|
| `scaleBy(factor, { for?, key?, excludeUpdates?, label? })` | Add a scale request. `factor` finite and > 0 (> 1 = speed-up; physics catch-up capped at ~8 sub-steps/frame). Returns `TimeEffectHandle { active, release() }` (idempotent) |
| `freezeFor(duration, { key?, label? })` | ×0 request for `duration` real-time seconds; same handle shape; takes no exclusions (whole-scene by design) |
| `effectiveScale` | `scene.timeScale × Π(channel winners)` — what physics and scene-pool processes run at |
| `elapsed` | Simulation seconds elapsed under `effectiveScale`, accrued once per rendered frame; held by stack pause, `timeScale = 0`, and freeze requests; starts at 0 on scene entry and is not saved |
| `fixedElapsed` | Simulation seconds accrued on the fixed timestep — one `fixedTimestep × effectiveScale` increment per fixed step; same holds as `elapsed` (stack pause, `timeScale = 0`, freeze); stamp and compare gameplay times against this from fixed-step code. Whole-scene reading: ignores `entity.timeScale` and `excludeUpdates` |
| `effectiveScaleForUpdates(entity)` | Same, but a channel whose winner excludes `entity` contributes 1; `entity.timeScale` is composed on top by the update pipeline |
| `isFrozen` | `effectiveScale === 0` |
| `activeLabels` | Display labels of active requests (`label` option, defaults to `key`) |

Composition: each `key` is a channel. Within a channel, the latest active request wins, and older still-active entries apply again when it ends. Across channels, winners multiply. An unkeyed call is its own anonymous channel. `scene.timeScale` is input-only — the service never writes it (nor `entity.timeScale`). Durations (`for`, `freezeFor`) age on raw frame time at the start of each frame, only while the scene is active — a stack-paused scene holds its effects, so pause-menu time does not consume a hitstop. `for: 0` / `freezeFor(0)` return an inactive handle without adding a request. All requests release on scene exit. Effects are transient across save/load — games re-issue them after loading a snapshot. `excludeUpdates` covers component updates, the entity's `ProcessComponent`, and its particle emitters. It does NOT cover physics: the excluded entity's rigid body still integrates at world speed, and physics-writing components under exclusion push forces at the excluded rate into a slowed world. The two elapsed readings differ in cadence: `elapsed` advances once per rendered frame at the start of the frame, `fixedElapsed` advances once per fixed step before the `FixedUpdate` phase runs — so a fixed-step reader sees the step it is inside, on the same cadence as a `"fixed"` process. `fixedElapsed` counts only the time the loop converted into fixed steps, so it trails `elapsed` by the accumulator remainder — under one fixed step on a steady frame rate, more right after a frame that clamped at `maxFixedStepsPerFrame`, whose unrun steps are spread over the following frames (the reading can then advance several steps between two reads taken outside the fixed phase). Inspector scene snapshots report `effectiveTimeScale` and `frozen`.

### Math

| Export | Purpose |
|---|---|
| `Vec2` | Immutable 2D vector (`add`, `sub`, `scale`, `normalize`, `lerp`, `dot`, `distance`, static `moveTowards`) |
| `Transform` | Mutable position/rotation/scale component (`setPosition`, `translate`, `rotate`); `worldPosition` / `worldRotation` / `worldScale` are lazily computed and cache-invalidate on local mutation or reparenting |
| `MathUtils` | `lerp`, `inverseLerp`, `lerpAngle`, `shortestAngleBetween`, `pingPong`, `smoothDamp`, `clamp`, etc. |
| `SmoothDampResult` | `{ value, velocity }` returned by `MathUtils.smoothDamp()` |

Math signatures:

```ts
MathUtils.lerp(a: number, b: number, t: number): number
MathUtils.inverseLerp(a: number, b: number, v: number): number // clamped 0..1
MathUtils.lerpAngle(a: number, b: number, t: number): number // radians, shortest path around +/-PI
MathUtils.shortestAngleBetween(a: number, b: number): number // signed delta in [-PI, PI]
MathUtils.pingPong(t: number, length: number): number // bounces in [0, length]
MathUtils.smoothDamp(
  current: number,
  target: number,
  velocity: number,
  smoothTime: number,
  deltaTime: number,
  maxSpeed?: number,
): SmoothDampResult

Vec2.lerp(a: Vec2Like, b: Vec2Like, t: number): Vec2
Vec2.moveTowards(current: Vec2Like, target: Vec2Like, maxDelta: number): Vec2
```

For `smoothDamp`, pass the returned `velocity` into the next frame. `smoothTime`
and `deltaTime` must use the same unit: pass the `dt` (seconds) the engine
gives you and express `smoothTime` in seconds. `maxSpeed` is in units per second.

### Scale inheritance

`Transform.worldScale` composes through the parent chain (`parent.worldScale * local.scale`), the same way `worldPosition` and `worldRotation` do. `DisplaySystem` reads `worldScale` each Render phase, so flipping a parent flips every descendant sprite automatically — useful for multi-layer characters (head + body + outfit) where every layer must flip together.

```ts
import { Entity, Transform } from "@yagejs/core";
import { SpriteComponent } from "@yagejs/renderer";

class Character extends Entity {
  setup() {
    this.add(new Transform());                      // parent — drives facing
    const body = this.spawnChild("body");
    body.add(new Transform());
    body.add(new SpriteComponent({ texture: "body.png" }));
    const head = this.spawnChild("head");
    head.add(new Transform({ position: { x: 0, y: -20 } }));
    head.add(new SpriteComponent({ texture: "head.png" }));
  }

  faceLeft(): void {
    this.get(Transform).setScale(-1, 1);            // mirrors body + head together
  }
  faceRight(): void {
    this.get(Transform).setScale(1, 1);
  }
}
```

Negative scale on a child still composes — a child with `setScale(-1, 1)` under a parent already at `(-1, 1)` ends up at `worldScale = (1, 1)` (un-mirrored). The same composition applies to positive non-unit scales (a parent at `2x` zooms its whole subtree).

### Processes

| Export | Purpose |
|---|---|
| `Process` | Ticked action, advanced by whichever clock it is scheduled on; `Process.delay(seconds, cb)`; `.elapsed` — seconds ticked so far, scaled by the caller's timeScale |
| `ProcessComponent` | Entity component managing processes and slots |
| `ProcessSlot` | Reusable restartable handle (cooldowns, effects) |
| `Tween` | Static factory: `to`, `custom`, `vec2`, `stagger` |
| `Sequence` | Chainable step builder: `then`, `wait`, `call`, `parallel`, `loop` |
| `TimerEntity` | Pre-built entity with ProcessComponent API |

Decision matrix:

| Need | Use |
|---|---|
| Wait N seconds then run a callback | `Process.delay()` |
| Cooldown / restartable timer (`completed`, `restart`) | `pc.slot()` |
| Animate one property A → B | `Tween.to()` / `.vec2()` |
| Interpolate a number from→to with a custom setter | `Tween.custom(setter, from, to, duration, easing?)` |
| Cascade a tween across an array (staggered starts) | `Tween.stagger(items, (item, i) => Process, stepSeconds)` → `Process[]` |
| Arbitrary per-frame logic (no interpolation) | `new Process({ update })` |
| Multi-step "do this, then this, then this" | `Sequence` |
| Run several animations together | `Sequence.parallel()` |
| Multi-point or non-monotonic animation curves | `KeyframeAnimator` |
| Fire discrete events at specific times | `KeyframeAnimator` keyframe `event` |

Tag processes with `pc.run(p, { tags: ["vfx"] })` then cancel groups with `pc.cancel("vfx")`. Processes and slots auto-cancel on entity destroy via `ProcessComponent.onDestroy()`.

Clocks (`ProcessClock = "frame" | "fixed"`): entity processes and slots tick on rendered-frame time by default (`ProcessSystem`, `Phase.Update`, priority 500). `pc.run(p, { clock: "fixed" })` / `pc.slot({ clock: "fixed", ... })` tick on the fixed timestep instead (`ProcessFixedUpdateSystem`, `Phase.FixedUpdate`, priority 500 — after physics, before component `fixedUpdate`). Use `"fixed"` for gameplay timing that must match a fixed-step simulation (attack windows, cooldowns); keep visuals on `"frame"`. Both clocks share pause gating and global/scene/entity time scaling. A slot's clock is fixed at creation — `start()`/`restart()` overrides exclude it. `ProcessSystem.add`/`addForScene` pools are frame-only.

`pc.removeSlot(slot): boolean` cancels and unregisters one owned `ProcessSlot`.
It returns `false` for a foreign or already-removed slot. Use it when a
component permanently discards a dynamically-created slot; `slot.cancel()`
alone keeps the reusable slot registered with its `ProcessComponent`.

### Animation

Keyframe-based property animation on top of `ProcessComponent`. Runs multiple named animations concurrently; values interpolate between keyframes via an easing function and are pushed to a user-supplied setter.

| Export | Purpose |
|---|---|
| `KeyframeAnimator<T>` | Component hosting named keyframe animations (`play`, `stop`, `stopAll`, `isPlaying`) |
| `Keyframe<T>` | `{ time, data, easing?, event? }` — single control point |
| `KeyframeAnimationDef<T>` | `{ keyframes, setter?, loop?, speed?, duration?, easing?, onEnter?, onExit? }` |
| `createKeyframeTrack<T>(options)` | Factory that returns a `Process` driving a single track |
| `interpolate<T>(from, to, t, easing?)` | Blend two `Interpolatable` values |
| `Interpolatable` | `number \| Vec2Like` — registered interpolation types |

```ts
import { KeyframeAnimator, ProcessComponent, Transform } from "@yagejs/core";

entity.add(new ProcessComponent());
const anim = entity.add(new KeyframeAnimator({
  bob: {
    keyframes: [
      { time: 0, data: 0 },
      { time: 0.5, data: 10 },
      { time: 1, data: 0 },
    ],
    setter: (v) => {
      const t = entity.get(Transform);
      t.setPosition(t.position.x, v as number);
    },
    loop: true,
  },
}));
anim.play("bob");
```

`KeyframeAnimator` requires `ProcessComponent` on the same entity. Each keyframe's `time` is in seconds along the track.

`setter` is **optional** — omit it for "pure timeline" animations that only
fire keyframe `event` callbacks (cutscenes, audio cues, gameplay beats):

```ts
new KeyframeAnimator({
  intro: {
    keyframes: [
      { time: 0,    data: 0, event: () => audio.play("step") },
      { time: 0.25, data: 0, event: () => audio.play("step") },
      { time: 0.5,  data: 0, event: () => audio.play("door") },
    ],
    // no setter — only the events matter
  },
});
```

`KeyframeAnimationDef.setter` is declared with method syntax so it's
contravariance-friendly: a `Record<string, KeyframeAnimationDef<number>>`
flows into the constructor unchanged, no `as` cast or widening helper needed.

### Randomness

Seeded per-scene RNG. `RandomKey` is a scene-scoped `ServiceKey<RandomService>`;
resolve it in a Component with `this.use(RandomKey)`. It stays deterministic
under `inspector.setSeed(seed)` and replays; `Math.random()` does not, so using
it breaks replay determinism.

```ts
import { RandomKey } from "@yagejs/core";

const rng = this.use(RandomKey);
rng.float();          // [0, 1)
rng.range(min, max);  // float in [min, max)
rng.int(min, max);    // integer in [min, max], inclusive
rng.pick(array);      // random element of a non-empty array
rng.shuffle(array);   // shuffle in place, returns the same array
rng.getSeed();        // current seed
```

`globalRandom` is a process-wide `RandomService` for boot-time or cross-scene
code that runs outside any scene. `inspector.setSeed` does not reseed it, so keep
replay-critical rolls on the scene RNG (`RandomKey`).

### Pause on Tab Blur

```ts
const scenes = this.context.resolve(SceneManagerKey);

scenes.autoPauseOnBlur = true;  // default: false
```

When enabled, `SceneManager` sets `scene.paused = true` on every scene in `activeScenes` on `document.hidden === true`, and restores them on `hidden === false`. Affected scenes get `onPause` on blur and `onResume` on focus. Only scenes paused by this mechanism are restored — user-paused scenes (manual `scene.paused = true` or `pauseBelow` cascade) are never touched, and get neither hook. Toggling the flag off mid-blur unpauses immediately. No-op in non-browser environments.

`onPause`/`onResume` fire on every effective pause transition, i.e. whenever `scene.isPaused` flips, whatever the source: a `pauseBelow` scene pushed above, manual `scene.paused = true`/`false`, blur auto-pause, or a snapshot restoring the scene paused. Writes that don't change the effective state fire nothing: repeated assignments, flag flips masked by a stack pause, and writes before the scene is pushed. Pushing a scene whose `paused` flag is already true fires `onPause` on entry — this is how you start a scene paused. Do NOT write `scene.paused` from inside a lifecycle hook (`onEnter`/`onExit`/`onPause`/`onResume`): the write races the stack transition's own pause diff, so the hooks can fire twice or unpaired. A dev-mode warning flags it.

### Scene Transitions

| Export | Purpose |
|---|---|
| `SceneTransition` | Interface: `duration`, `begin?`, `tick`, `end?` |
| `SceneTransitionContext` | `elapsed`, `kind`, `engineContext`, `fromScene`, `toScene` |
| `SceneTransitionKind` | `"push" \| "pop" \| "replace"` |
| `SceneTransitionOptions` | `{ transition?: SceneTransition }` |
| `resolveTransition(callSite, destination)` | Precedence: call-site → `scene.defaultTransition` → undefined |

Core ships the transition contract + orchestration only. Concrete transitions (`fade`, `flash`, `crossFade`) live in `@yagejs/renderer`.

`SceneManager.push/pop/replace` accept `{ transition }`. `Scene.defaultTransition` provides a per-scene default. `Scene.isTransitioning` and `SceneManager.isTransitioning` reflect active transition state.

Events: `scene:transition:started { kind, fromScene, toScene }`, `scene:transition:ended { kind, fromScene, toScene }` (fromScene/toScene may be `undefined`).

**Breaking:** `SceneManager.pop()` returns `Promise<Scene | undefined>`.

#### Reentrant scene swaps

`push`/`pop`/`replace`/`popAll` are safe to call from inside a lifecycle hook
(`onEnter`, `onExit`, `onPause`, `onResume`, or a `beforeEnter`/`afterExit`
hook). The call is queued on the manager's internal pending chain and runs
after the current mutation finishes; the returned promise resolves when the
deferred operation completes.

```ts
class TitleScene extends Scene {
  onEnter() {
    // Safe — `replace` is queued and runs after TitleScene's onEnter returns.
    if (saveSystem.hasAutosave()) {
      this.context.resolve(SceneManagerKey).replace(new GameScene());
    }
  }
}
```

Dev builds emit a `console.warn` because reentrant swaps are usually a smell
(an `onEnter` that immediately replaces the scene rarely matches intent, and
a dropped promise can hide errors). Production builds suppress the warning.

### Easing

`easeLinear`, `easeInQuad`, `easeOutQuad`, `easeInOutQuad`, `easeOutBounce`

### Serialization

| Export | Purpose |
|---|---|
| `@serializable` | Class decorator for save/load registration |
| `SerializableRegistry` | Auto-populated registry of decorated classes |
| `SnapshotResolver` | Maps old entity IDs to restored instances in `afterRestore()` |

`static restorePriority?: number` on a Component subclass sets its snapshot restore order: components are re-added in ascending priority on load (undeclared = 100, the engine reserves 0-99), so an `onAdd()` that reads a sibling declares a higher number than that sibling. Ties restore in save-time add order; subclasses inherit the base class's value.

### Traits

| Export | Purpose |
|---|---|
| `defineTrait<T>(name)` | Define a trait token |
| `@trait(token)` | Decorator: declare entity implements trait |
| `TraitToken<T>` | Token used with `entity.hasTrait(token)` |
| `entityClassHasTrait(EntityClass, token)` | Check whether an entity class declares or inherits a trait before spawning it |

### Entity Queries

| Export | Purpose |
|---|---|
| `QueryCache` | Incremental entity query cache |
| `QueryResult` | Iterable result from `cache.register([Component, ...])` |
| `cache.queryOnce([Component, ...])` | Detached, seeded, one-shot `QueryResult` — never registered, never updated |
| `filterEntities(entities, filter)` | One-off filter by name, tag, component, or trait; skips destroyed and dormant entities |

`cache.register(filter)` returns a `QueryResult` pre-populated with entities that already match, then kept current via `onComponentAdded`/`onComponentRemoved`/`onEntityDestroyed`/`onEntityActivated`/`onEntityDeactivated`. Only active entities are ever members — see Activeness above. Call `cache.unregister(result)` when it no longer needs live updates — otherwise it keeps receiving updates forever. Queries registered once at system-install time (`DisplaySystem`, `UILayoutSystem`) are engine-lifetime by design and are never unregistered; per-mount registrations (e.g. `@yagejs/ui-react`'s `useQuery`) release on unmount.

`cache.queryOnce(filter)` builds the same seeded snapshot but skips registration entirely — use it for a point-in-time read (e.g. a render-phase snapshot) that must not hold a live entry in the cache.

### Stable Identity

Opt-in per-scene entity keys. Most entities (bullets, particles, transient enemies) don't need them; pass `{ key }` only for entities whose state should persist (chests, doors, named NPCs).

| Export | Purpose |
|---|---|
| `SpawnOptions` | `{ key?: string }` — trailing arg of `scene.spawn` / `entity.spawnChild` |
| `entity.key` | `string \| undefined` — the assigned key |
| `entity.requireKey()` | Returns `key` or throws (use in component `setup()`) |
| `scene.findByKey<E>(key)` | Look up entity by key, scene-scoped, hides destroyed entities |

```ts
scene.spawn(Chest, { content: ["potion"] }, { key: "forest/chest-01" });
scene.spawn(Plain, { key: "spawn-point" });        // class with no setup-params
scene.spawn("anchor", { key: "anchor-01" });       // anonymous entity with a key
parent.spawnChild("body", Bone, { key: "bone-01" });

const chest = scene.findByKey<Chest>("forest/chest-01");
```

The class form derives its trailing args from the entity's `setup` PARAMETER. No declared `setup`, or a zero-parameter `setup(): void` → `spawn(Class, options?)` (no params slot). `setup(params)` with a required parameter → params is required: `spawn(Class, params, options?)`, and `spawn(Class)` is a type error (even when every field of `params` is optional — a required parameter still means `setup(undefined)` would crash). `setup(params?)` or a defaulted parameter → params optional: `spawn(Class, params?, options?)`. Omitting a required field reports that field as missing on the params object (`Property 'spawnPoint' is missing`), naming the field that's actually absent.

The params slot takes the setup param type, not `SpawnOptions`, so a `SpawnOptions`-shaped literal (e.g. `{ key }`) is rejected there; assign a key to an all-optional-param class via the 3-arg form `spawn(Class, {}, { key })`. Edge case: if the setup param type itself declares an optional `key`, `{ key }` satisfies the params slot and the runtime routes it to options — don't name a top-level setup-params field `key`; if you must, use the 3-arg form. The 3-arg form `spawn(Class, params, options)` is always unambiguous.

If a class entity's `setup()` method throws, `scene.spawn()` destroys and removes the entity immediately, including its components and stable-key entry, then rethrows the original error.

Duplicate keys throw at spawn time with no orphan side-effect — the entity is not added to `scene.entities` and `entity:created` is not emitted. Keys are immutable for an entity's lifetime; destroy + respawn to swap. The index is per-scene and clears on scene teardown. Identity is independent of `@yagejs/save` — game code uses `entity.key` as a stable id in persistent stores (`createSet<string>()`).

### Assets

| Export | Purpose |
|---|---|
| `AssetHandle<T>` | Typed handle returned by asset factory functions |
| `AssetManager` | Load/unload assets, register loaders |

### Testing

| Export | Purpose |
|---|---|
| `createTestEngine(config?)` | Fully assembled Engine for integration tests |
| `createMockScene(name?)` | Lightweight scene with EngineContext for unit tests |
| `createMockEntity(name?)` | Entity spawned in a mock scene |
| `advanceFrames(engine, n, dtMs?)` | Advance game loop by N frames (`dtMs` is the per-frame ms delta; default `1000/60`) |

See also the `Testing & Debugging` section in the Quick Start for a runnable example and the Inspector API for runtime introspection.

### Logging & Diagnostics

Category-tagged logger with a ring buffer. Installed on `Engine` and available via `LoggerKey`. The game loop auto-updates the logger's frame counter, so every `LogEntry` carries the frame number it was emitted on.

| Export | Purpose |
|---|---|
| `Logger` | `debug`, `info`, `warn`, `error` (all take `category, message, data?`); `getRecent(count?)`, `formatRecentLogs(count?)`, `clear()` |
| `LogLevel` | `Debug` (0) / `Info` (1) / `Warn` (2) / `Error` (3) / `None` (4) |
| `LoggerConfig` | `{ level?, categories?, bufferSize?, output? }` |
| `LogEntry` | `{ level, category, message, data?, timestamp, frame }` |
| `LoggerKey` | DI key for resolving a `Logger` from `EngineContext` |

```ts
import { LogLevel } from "@yagejs/core";

const engine = new Engine({ debug: true });

engine.logger.info("physics", "Shape spawned", { x: 100, y: 200 });
engine.logger.warn("gameplay", "Low health");
engine.logger.error("render", "Texture missing", { key: "hero.png" });

// Dump the most recent entries (e.g. on crash)
console.log(engine.logger.formatRecentLogs(20));
```

`bufferSize` (default 500) caps the ring buffer. `categories` restricts which categories are accepted. `output` overrides the default `console.*` handler with a custom sink (e.g., to ship logs to a remote service).

### Well-known DI Keys

`EngineKey`, `EventBusKey`, `SceneManagerKey`, `LoggerKey`, `QueryCacheKey`, `ErrorBoundaryKey`, `GameLoopKey`, `InspectorKey`, `SystemSchedulerKey`, `ProcessSystemKey`, `AssetManagerKey`

## LoadingScene

Base class for a progress-bar loading screen. Orchestrates preload, emits events on the bus, and hands off to a target scene. No rendering — the visual lives in `@yagejs/ui` (`LoadingSceneProgressBar`) or user-written components subscribing to the events. Full reference: `loading-scene.md`.

```ts
import { LoadingScene } from "@yagejs/core";
import { fade } from "@yagejs/renderer";
import { LoadingSceneProgressBar } from "@yagejs/ui";

class Boot extends LoadingScene {
  readonly target = new GameScene();
  readonly minDuration = 0.5;
  readonly transition = fade({ duration: 0.3 });
  override onEnter() {
    this.spawn(LoadingSceneProgressBar);
    this.startLoading();
  }
}
```

Emits `scene:loading:progress` and `scene:loading:done` on `EventBusKey`. Set `autoContinue = false` and call `scene.continue()` to gate the handoff (e.g. "press any key").

## State

Typed reactive primitives for game-wide singleton state. Used by `@yagejs/ui-react`'s `useStore` and the save layer.

### Contracts

Three independent interfaces; every `Reactive*` shape implements all three:

```ts
interface Reactive            { subscribe(fn: () => void): () => void }
interface Serializable<TEnc>  { serialize(): TEnc; hydrate(raw: TEnc): void }
interface Resettable          { reset(): void }
```

Each shape also carries a `[STATE_KIND]` symbol-brand (`"value" | "counter" | "record" | "map" | "set" | "list" | "store"`) — `useStore` dispatches on it.

```ts
interface ReactiveValue<T>          extends Reactive, Serializable<{value:T}>, Resettable { get(): T; set(v: T): void }
interface ReactiveCounter           extends Reactive, Serializable<number>,     Resettable {
  value(): number; set(n: number): void; increment(by?: number): void;
  decrement(by?: number): void; clamp(value: number, min: number, max: number): void;
}
interface ReactiveRecord<T extends object> extends Reactive, Serializable<T>, Resettable {
  get(): Readonly<T>; set(partial: Partial<T>): void;
}
interface ReactiveMap<K, V>         extends Reactive, Serializable<Array<[K,V]>>, Resettable {
  get(k: K): V | undefined; set(k: K, v: V): void; delete(k: K): void;
  has(k: K): boolean; entries(): Array<[K, V]>; size(): number; clear(): void;
}
interface ReactiveSet<K>            extends Reactive, Serializable<K[]>, Resettable {
  add(k: K): void; delete(k: K): void; has(k: K): boolean;
  values(): K[]; size(): number; clear(): void;
}
interface ReactiveList<T>           extends Reactive, Serializable<ListEncoded<T>>, Resettable {
  add(item: T): number;            // returns assigned id
  remove(id: number): boolean;     // by id, not delete — semantically distinct
  get(id: number): T | undefined; update(id: number, partial: Partial<T>): boolean;
  list(): T[]; size(): number; clear(): void;
  // keyed lookup — requires the `keyBy` option, else these throw.
  // A keyed list holds at most one item per key; add/update/upsert throw on a
  // duplicate key. upsert requires keyBy(item) === key.
  findId(key: string | number): number | undefined;   // id for a domain key
  getByKey(key: string | number): T | undefined;       // item for a domain key
  upsert(key: string | number, item: T): number;       // add-or-replace by key; returns id
}
interface ReactiveStore<L>          extends Reactive, Serializable<EncodedStore<L>>, Resettable { /* plus L's leaves */ }
```

### Factories

```ts
import {
  createValue, createCounter, createRecord,
  createMap, createSet, createList, createStore,
} from "@yagejs/core";

// Leaf factories — usable on their own.
const settings = createRecord<Settings>({ default: () => ({ music: 0.8, sfx: 1.0 }) });
const opened    = createSet<string>();
const enemies   = createMap<string, number>();
const restEpoch = createCounter();
const day       = createValue<number>({ default: 1 });
const journal   = createList<{ at: number; text: string }>();

// Keyed list — pass `keyBy` to look items up by a domain field in O(1).
// Keys are unique: at most one item per key. add/update/upsert throw if the
// result would share a key with another item; upsert requires keyBy(item) === key.
const inventory = createList<{ itemId: string; quantity: number }>({
  keyBy: (slot) => slot.itemId,
});
inventory.upsert("sword", { itemId: "sword", quantity: 1 }); // insert
inventory.upsert("sword", { itemId: "sword", quantity: 2 }); // replace in place
inventory.findId("sword");    // -> id
inventory.getByKey("sword");  // -> { itemId: "sword", quantity: 2 }

// Compound — bundle leaves so they serialise/restore atomically.
const game = createStore((s) => ({
  inventory: s.map<string, number>(),
  recipes:   s.set<string>(),
  gold:      s.counter({ default: 0 }),
  shelf:     s.list<Potion>(),
  day:       s.value<number>({ default: 1 }),
  settings:  s.record<Settings>({ default: () => ({ volume: 0.8, lang: "en" }) }),
}));
game.gold.increment(10);
game.inventory.set("moonleaf", 3);
```

Factories take no id and no version — they return fresh, pure data instances. Ids and version envelopes live at the save call site (`@yagejs/save`). `useStore(compound)` works and returns the encoded snapshot, though reading individual leaves keeps subscription granularity per-leaf.

Codecs for non-JSON-native types: `jsonCodec()`, `setCodec<K>()`, `mapCodec<K,V>()`, `dateCodec()`. Set/Map/Counter/List bundle codecs internally; you only specify a codec on `createRecord<T>` / `createValue<T>` (or the matching `s.record`/`s.value` leaves) for exotic types.

See `@yagejs/save` docs for the IO layer that consumes any `Serializable<T>`.

## Core Types

```ts
interface Plugin {
  readonly name: string;
  readonly version: string;
  readonly dependencies?: readonly string[];
  install?(context: EngineContext): void | Promise<void>;
  registerSystems?(scheduler: SystemScheduler): void;
  onStart?(): void;
  onDestroy?(): void;
}

enum Phase {
  EarlyUpdate, FixedUpdate, Update, LateUpdate, Render, EndOfFrame
}

type EasingFunction = (t: number) => number;
type ComponentClass<C> = new (...args: never[]) => C;
```

### Execution context

The scheduler (resolve via `SystemSchedulerKey`) reports where the current
call is executing. Code reachable from several phases branches on these
instead of assuming a phase — `@yagejs/input` uses them to scope edge queries
to the caller's frame or fixed step:

```ts
scheduler.currentPhase;   // Phase | null — phase running right now; null outside any phase
scheduler.fixedStepIndex; // number — monotonic count of fixed steps started; identifies
                          // the running step during Phase.FixedUpdate (a frame can run
                          // several steps, or none), holds the last step's number between steps
```

## Error Handling

`ErrorBoundary` wraps system, component, and callback execution so a throw is
attributed to whoever threw, not whoever it reached. It never disables,
unsubscribes, mutes, or cancels anything — it records the culprit, logs it,
and rethrows.

- `wrapSystem(system, fn)` / `wrapComponent(component, fn)` — used internally
  by `SystemScheduler` and `ComponentUpdateSystem`. On throw, records the
  system/component's identity (and owning entity for a component), logs it
  through `Logger`, and rethrows.
- `wrapCallback(fn, info)` wraps a developer-supplied callback the engine
  invokes on its own — collision/trigger handlers, entity/scene event
  handlers, the global `EventBus`, input listeners (key/action/gamepad/
  pointer/wheel), process and process-slot callbacks, the audio unlock
  callback. It catches a
  synchronous throw and, since these callbacks are typed void-returning but
  nothing stops a caller from passing an `async` function, a rejected
  thenable too — the thenable case is re-raised as a new unhandled rejection,
  since a rejected `.then()` handler can't rethrow into the original
  (already-returned) call stack.
- `wrapLifecycleHook(fn, info)` wraps a scene lifecycle hook
  (`onEnter`/`onExit`/`onPause`/`onResume`/`beforeEnter`). A synchronous
  throw is reported through `Logger` and rethrown, so a scene half-built by a
  throwing hook always fails the same way — it must not look like it mounted
  cleanly. A rejected thenable can only be reported (via
  `reportLifecycleError()`), not rethrown — the hook call has already
  returned by the time the rejection settles, so there's no caller stack
  left to rethrow into.
- Every failure is recorded in `ErrorBoundary.getCallbackErrors()` and
  surfaced as `Inspector.getErrors().callbackErrors` — a bounded history (the
  200 most recent) with each entry's kind and owning entity/scene/event where
  known. The same `Error` object propagating through nested wraps (a
  collision handler's throw reaching the surrounding `wrapSystem`) is
  recorded and logged once, not once per wrap.
- `GameLoop.tick()` is the one place that decides a failure is terminal: an
  error that escapes an entire frame unhandled stops the loop and rethrows,
  so it reaches the host. A caller's own `try`/`catch` around a dispatching
  call (`entity.emit(...)`, `bus.emit(...)`, ...) leaves the loop running.
- Writing a new dispatch site that calls developer-supplied code should route
  it through `wrapCallback`/`wrapLifecycleHook` rather than calling the
  callback directly — see the "Attribute developer-supplied callbacks" rule
  in the repo-root `AGENTS.md`.

`Logger` writes to the console by default in dev builds (gated by `isDev()`, tree-shakable in production the same way as `devWarn`). Pass `logger: { output }` in the `Engine` config to replace it; `LogLevel.None` silences everything. The `output` sink itself is guarded — a throwing sink is disabled after its first failure instead of taking down whatever was being reported.
