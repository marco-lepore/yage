# YAGE Patterns

## Component Patterns

### Service and sibling resolution

```ts
class PlayerController extends Component {
  // Lazy proxy -- safe at field-declaration time, resolves on first access
  private input = this.service(InputManagerKey);
  private sprite = this.sibling(SpriteComponent);

  // Cached resolution -- only usable after onAdd()
  private camera!: Camera;
  onAdd() {
    this.camera = this.use(CameraKey);
  }

  update(dt: number) {
    const dir = this.input.getVector("left", "right", "up", "down");
    this.entity.get(Transform).translate(dir.scale(200 * dt / 1000));
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
    this.listenScene(SpawnEvent, (data, entity) => { /* ... */ });
  }
}
```

### Error boundary behavior

If `update()` or `fixedUpdate()` throws, the component is disabled (`enabled = false`). The game continues running. Disabled components are skipped by `ComponentUpdateSystem`. Check `ErrorBoundary.getDisabled()` for diagnostics.

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
  setup() { /* ... */ }
}

// Query with type guard:
for (const e of scene.findEntities({ trait: Damageable })) {
  e.takeDamage(1); // typed
}
```

### Blueprints (deprecated)

`defineBlueprint()` still works but entity subclasses with `setup()` are preferred.

## Process Patterns

### Cooldown slot

```ts
class Weapon extends Component {
  private pc = this.sibling(ProcessComponent);
  private cooldown!: ProcessSlot;

  onAdd() {
    this.cooldown = this.entity.get(ProcessComponent).slot({ duration: 500 });
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
const seq = new Sequence()
  .call(() => ui.showDialogue("Watch out!"))
  .wait(2000)
  .then(Tween.to(boss, "y", 100, 800, easeOutQuad))
  .call(() => ui.hideDialogue())
  .then(Tween.custom(v => camera.zoom = v, 1, 1.5, 500));

pc.run(seq.start());
```

### Tween animation

```ts
// Property tween
pc.run(Tween.to(transform, "rotation", Math.PI, 500, easeInOutQuad));

// Custom setter
pc.run(Tween.custom(v => sprite.alpha = v, 1, 0, 300));

// Vec2 tween
pc.run(Tween.vec2(
  v => transform.setPosition(v),
  Vec2.ZERO,
  new Vec2(200, 100),
  600,
  easeOutBounce,
));
```

### Process.delay for one-shots

```ts
pc.run(Process.delay(1000, () => entity.destroy()));
```

## Testing Patterns

```ts
import { createMockEntity, createMockScene, createTestEngine, advanceFrames } from "@yage/core";

// Unit test a component
const { entity, scene, context } = createMockEntity();
entity.add(new Transform());
entity.add(new MyComponent());
entity.get(MyComponent).update(16.67);

// Integration test with real engine
const engine = await createTestEngine();
engine.scenes.push(new TestScene());
advanceFrames(engine, 10); // advance 10 frames at 60fps

// Mock scene for isolated tests
const { scene, context } = createMockScene("test");
const e = scene.spawn("test-entity");
```

Co-locate tests: `Foo.ts` -> `Foo.test.ts` in the same directory.

## Scene Management Patterns

### Pause menu

```ts
class PauseScene extends Scene {
  override readonly pauseBelow = true;        // freeze scene below
  override readonly transparentBelow = true;  // keep rendering below

  onEnter() {
    // Push: engine.scenes.push(new PauseScene());
    // Resume: engine.scenes.pop();
  }
}
```

### Time scale

```ts
scene.timeScale = 0.25;  // slow-mo
scene.timeScale = 2;     // fast-forward
```

### Cross-scene access

```ts
const game = engine.scenes.all.find(s => s.name === "game") as GameScene;
game.timeScale = 0.25;
```

## State Management Patterns

### DI service for game state

```ts
const GameStateKey = new ServiceKey<GameState>("gameState");
this.context.register(GameStateKey, { score: 0, health: 100 });
// Access: this.use(GameStateKey).score
```

### Reactive store (for React UI)

```ts
const store = createStore({ score: 0 });
store.set({ score: 10 });                    // ECS writes
const score = useStore(store, s => s.score); // React reads
```

### Event-driven state

```ts
const CoinCollected = defineEvent("coin:collected");
this.on(CoinCollected, () => { state.score += 10; });
entity.emit(CoinCollected);  // from trigger handler
```

## Common Game Patterns

### Blueprints for spawning

```ts
const CoinBP = defineBlueprint<{ x: number; y: number }>("coin", (entity, { x, y }) => {
  entity.add(new Transform({ position: new Vec2(x, y) }));
  entity.add(new ColliderComponent({ shape: { type: "circle", radius: 10 }, sensor: true }));
});
scene.spawn(CoinBP, { x: 200, y: 300 });
```

### Health/damage

```ts
class HealthComponent extends Component {
  hp: number;
  constructor(public readonly maxHp: number) { super(); this.hp = maxHp; }
  takeDamage(n: number) { this.hp = Math.max(0, this.hp - n); if (this.hp <= 0) this.entity.emit(EntityDied); }
}
```

### Ground detection (raycast)

```ts
const hit = world.raycast(position, { x: 0, y: 1 }, halfHeight + 2);
const grounded = hit !== null; // add coyote timer for better feel
```

## Common Gotchas

**setup() vs constructor**: Entity constructors run before scene wiring. Always use `setup()` for adding components and resolving services.

**Deferred destruction**: `entity.destroy()` marks for destruction. Actual cleanup happens in EndOfFrame phase. Don't assume immediate removal.

**Fixed vs variable dt**: `update(dt)` receives variable frame delta. `fixedUpdate(dt)` receives the fixed timestep. Use `fixedUpdate` for physics-sensitive logic.

**Vec2 is immutable**: `vec.add(other)` returns a new Vec2. Transform has mutating methods (`setPosition`, `translate`).

**Pixels everywhere**: All user-facing APIs work in pixels. Physics coordinate conversion is internal.

**Component uniqueness**: One component per class per entity. `entity.add()` throws if the class already exists.

**No pixi.js in core**: `@yage/core` has zero runtime dependencies. Never import pixi.js in core code.
