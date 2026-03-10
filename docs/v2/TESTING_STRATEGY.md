# YAGE v2 -- Testing Strategy

## Overview

YAGE v2 uses a two-tier testing approach:

1. **Unit tests (Vitest, Node.js)**: All pure logic -- math, events, queries, prefabs, processes, error boundaries, inspector. Fast, no browser required.
2. **Integration tests (Playwright, Chromium)**: Full engine running in a real browser. Tests query state via `window.__yage__.inspector`, not screenshots. Input simulation via Playwright keyboard/mouse APIs.

No visual regression testing. The Inspector API replaces pixel comparison with structured state assertions.

---

## 1. Unit Tests (Vitest)

### Configuration

```typescript
// vitest.workspace.ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*/vitest.config.ts',
]);

// packages/core/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
```

### File Conventions

Unit tests are **co-located** with source files:

```
packages/core/
  src/
    Vec2.ts
    Vec2.test.ts
    Entity.ts
    Entity.test.ts
    EventBus.ts
    EventBus.test.ts
    ...
```

### Coverage Target

- `@yage/core`: **100% statement coverage** target. 31 test files exist covering all core APIs. This is the foundation -- no shortcuts.
- Other packages: **High coverage** on logic. Current test file counts:
  - `@yage/renderer`: 8 test files
  - `@yage/physics`: 10 test files
  - `@yage/particles`: 6 test files
  - `@yage/tilemap`: 6 test files
  - `@yage/ui`: 8 test files
  - `@yage/ui-react`: 4 test files
  - `@yage/audio`: 4 test files
  - `@yage/input`: 2 test files
  - `@yage/debug`: 4 test files
- Rendering/audio that requires browser APIs are covered by E2E tests instead.

### Test Patterns

#### Vec2 / MathUtils

```typescript
// Vec2.test.ts
import { describe, it, expect } from 'vitest';
import { Vec2 } from './Vec2';

describe('Vec2', () => {
  it('adds two vectors', () => {
    const a = new Vec2(1, 2);
    const b = new Vec2(3, 4);
    const result = a.add(b);
    expect(result.x).toBe(4);
    expect(result.y).toBe(6);
  });

  it('is immutable (add returns new instance)', () => {
    const a = new Vec2(1, 2);
    const b = new Vec2(3, 4);
    const result = a.add(b);
    expect(result).not.toBe(a);
    expect(result).not.toBe(b);
  });

  it('normalizes a vector', () => {
    const v = new Vec2(3, 4);
    const n = v.normalize();
    expect(n.length()).toBeCloseTo(1);
    expect(n.x).toBeCloseTo(0.6);
    expect(n.y).toBeCloseTo(0.8);
  });

  it('handles zero vector normalization', () => {
    const v = Vec2.ZERO.normalize();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
  });

  it('calculates distance', () => {
    const a = new Vec2(0, 0);
    const b = new Vec2(3, 4);
    expect(a.distance(b)).toBe(5);
  });

  it('lerps between vectors', () => {
    const a = new Vec2(0, 0);
    const b = new Vec2(10, 20);
    const mid = a.lerp(b, 0.5);
    expect(mid.x).toBe(5);
    expect(mid.y).toBe(10);
  });
});
```

#### EventBus

```typescript
// EventBus.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './EventBus';

interface TestEvents {
  'score:changed': { score: number };
  'player:died': void;
}

describe('EventBus', () => {
  it('delivers events to subscribers', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    bus.on('score:changed', handler);
    bus.emit('score:changed', { score: 42 });

    expect(handler).toHaveBeenCalledWith({ score: 42 });
  });

  it('returns unsubscribe function', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    const unsub = bus.on('score:changed', handler);
    unsub();
    bus.emit('score:changed', { score: 42 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('once() auto-unsubscribes after first emission', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    bus.once('score:changed', handler);
    bus.emit('score:changed', { score: 1 });
    bus.emit('score:changed', { score: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ score: 1 });
  });

  it('calls handlers in registration order', () => {
    const bus = new EventBus<TestEvents>();
    const order: number[] = [];

    bus.on('player:died', () => order.push(1));
    bus.on('player:died', () => order.push(2));
    bus.on('player:died', () => order.push(3));
    bus.emit('player:died', undefined as any);

    expect(order).toEqual([1, 2, 3]);
  });

  it('clear() removes all handlers for an event', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    bus.on('score:changed', handler);
    bus.clear('score:changed');
    bus.emit('score:changed', { score: 42 });

    expect(handler).not.toHaveBeenCalled();
  });
});
```

#### Entity + Component

```typescript
// Entity.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Entity } from './Entity';
import { Component } from './Component';
import { Transform } from './Transform';
import { createMockScene } from './test-utils';

class HealthComponent extends Component {
  hp: number;
  constructor(hp: number) {
    super();
    this.hp = hp;
  }
}

describe('Entity', () => {
  it('adds and retrieves components by class', () => {
    const scene = createMockScene();
    const entity = scene.spawn('test');

    entity.add(new Transform());
    entity.add(new HealthComponent(100));

    expect(entity.get(Transform)).toBeInstanceOf(Transform);
    expect(entity.get(HealthComponent).hp).toBe(100);
  });

  it('throws on get() for missing component', () => {
    const scene = createMockScene();
    const entity = scene.spawn('test');

    expect(() => entity.get(HealthComponent)).toThrow();
  });

  it('returns undefined for tryGet() on missing component', () => {
    const scene = createMockScene();
    const entity = scene.spawn('test');

    expect(entity.tryGet(HealthComponent)).toBeUndefined();
  });

  it('has() checks component presence', () => {
    const scene = createMockScene();
    const entity = scene.spawn('test');

    expect(entity.has(Transform)).toBe(false);
    entity.add(new Transform());
    expect(entity.has(Transform)).toBe(true);
  });

  it('calls onAdd when component is added', () => {
    const scene = createMockScene();
    const entity = scene.spawn('test');
    const comp = new HealthComponent(100);
    comp.onAdd = vi.fn();

    entity.add(comp);
    expect(comp.onAdd).toHaveBeenCalled();
  });

  it('calls onRemove when component is removed', () => {
    const scene = createMockScene();
    const entity = scene.spawn('test');
    const comp = new HealthComponent(100);
    comp.onRemove = vi.fn();

    entity.add(comp);
    entity.remove(HealthComponent);
    expect(comp.onRemove).toHaveBeenCalled();
  });

  it('sets entity reference on component', () => {
    const scene = createMockScene();
    const entity = scene.spawn('test');
    const comp = new HealthComponent(100);

    entity.add(comp);
    expect(comp.entity).toBe(entity);
  });
});
```

#### QueryCache

```typescript
// QueryCache.test.ts
import { describe, it, expect } from 'vitest';
import { Component } from './Component';
import { QueryCache } from './QueryCache';
import { Transform } from './Transform';
import { createMockScene } from './test-utils';

class Velocity extends Component {}
class Renderable extends Component {}

describe('QueryCache', () => {
  it('returns matching entities', () => {
    const scene = createMockScene();
    const cache = new QueryCache();

    const query = cache.register([Transform, Velocity]);

    const e1 = scene.spawn('e1');
    e1.add(new Transform());
    cache.onComponentAdded(e1, Transform);
    e1.add(new Velocity());
    cache.onComponentAdded(e1, Velocity);

    const e2 = scene.spawn('e2');
    e2.add(new Transform());
    cache.onComponentAdded(e2, Transform);
    // e2 has no Velocity, should not match

    expect(query.size).toBe(1);
    expect([...query][0]).toBe(e1);
  });

  it('removes entities when components are removed', () => {
    const scene = createMockScene();
    const cache = new QueryCache();
    const query = cache.register([Transform]);

    const entity = scene.spawn('e');
    entity.add(new Transform());
    cache.onComponentAdded(entity, Transform);
    expect(query.size).toBe(1);

    entity.remove(Transform);
    cache.onComponentRemoved(entity, Transform);
    expect(query.size).toBe(0);
  });

  it('handles multiple queries independently', () => {
    const scene = createMockScene();
    const cache = new QueryCache();

    const q1 = cache.register([Transform]);
    const q2 = cache.register([Transform, Velocity]);

    const entity = scene.spawn('e');
    entity.add(new Transform());
    cache.onComponentAdded(entity, Transform);

    expect(q1.size).toBe(1);
    expect(q2.size).toBe(0); // Missing Velocity

    entity.add(new Velocity());
    cache.onComponentAdded(entity, Velocity);

    expect(q1.size).toBe(1);
    expect(q2.size).toBe(1); // Now matches both
  });
});
```

#### ErrorBoundary

```typescript
// ErrorBoundary.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';
import { Logger, LogLevel } from './Logger';

describe('ErrorBoundary', () => {
  it('catches system errors and disables the system', () => {
    const logger = new Logger({ level: LogLevel.None });
    const boundary = new ErrorBoundary(logger);

    const system = { enabled: true, phase: 'update', priority: 0 } as any;
    const badFn = () => { throw new Error('boom'); };

    boundary.wrapSystem(system, badFn);

    expect(system.enabled).toBe(false);
  });

  it('does not disable system on successful execution', () => {
    const logger = new Logger({ level: LogLevel.None });
    const boundary = new ErrorBoundary(logger);

    const system = { enabled: true, phase: 'update', priority: 0 } as any;
    const goodFn = vi.fn();

    boundary.wrapSystem(system, goodFn);

    expect(system.enabled).toBe(true);
    expect(goodFn).toHaveBeenCalled();
  });

  it('logs errors', () => {
    const logger = new Logger({ level: LogLevel.Debug });
    const errorSpy = vi.spyOn(logger, 'error');
    const boundary = new ErrorBoundary(logger);

    const system = { enabled: true } as any;
    boundary.wrapSystem(system, () => { throw new Error('test error'); });

    expect(errorSpy).toHaveBeenCalled();
  });

  it('tracks disabled systems for inspection', () => {
    const logger = new Logger({ level: LogLevel.None });
    const boundary = new ErrorBoundary(logger);

    const system = { enabled: true } as any;
    boundary.wrapSystem(system, () => { throw new Error('boom'); });

    const disabled = boundary.getDisabled();
    expect(disabled.systems).toContain(system);
  });
});
```

#### Process / Tween

```typescript
// Process.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Process, Tween, Sequence } from './Process';

describe('Tween', () => {
  it('interpolates from start to end over duration', () => {
    const values: number[] = [];
    const process = Tween.custom(v => values.push(v), 0, 100, 1000);

    // Simulate 10 frames of 100ms each
    for (let i = 0; i < 10; i++) {
      process._update(100);
    }

    expect(values[0]).toBeCloseTo(10);
    expect(values[4]).toBeCloseTo(50);
    expect(values[9]).toBeCloseTo(100);
    expect(process.completed).toBe(true);
  });

  it('resolves promise on completion', async () => {
    const process = Tween.custom(() => {}, 0, 1, 100);

    const promise = process.toPromise();
    process._update(100);

    await expect(promise).resolves.toBeUndefined();
  });

  it('can be cancelled', () => {
    const update = vi.fn();
    const process = Tween.custom(update, 0, 1, 1000);

    process.cancel();
    process._update(100);

    expect(update).not.toHaveBeenCalled();
  });
});

describe('Sequence', () => {
  it('runs steps in order', () => {
    const order: number[] = [];

    const seq = new Sequence()
      .call(() => order.push(1))
      .call(() => order.push(2))
      .call(() => order.push(3));

    const process = seq._build();
    process._update(0);

    expect(order).toEqual([1, 2, 3]);
  });

  it('waits between steps', () => {
    const calls: number[] = [];

    const seq = new Sequence()
      .call(() => calls.push(1))
      .wait(500)
      .call(() => calls.push(2));

    const process = seq._build();
    process._update(0);     // call 1
    expect(calls).toEqual([1]);

    process._update(250);   // mid-wait
    expect(calls).toEqual([1]);

    process._update(250);   // wait complete, call 2
    expect(calls).toEqual([1, 2]);
  });
});
```

#### SceneManager

```typescript
// SceneManager.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SceneManager } from './SceneManager';
import { Scene } from './Scene';

class TestScene extends Scene {
  readonly name: string;
  onEnter = vi.fn();
  onExit = vi.fn();
  onPause = vi.fn();
  onResume = vi.fn();

  constructor(name: string) {
    super();
    this.name = name;
  }
}

describe('SceneManager', () => {
  it('push calls onEnter on new scene', () => {
    const manager = new SceneManager();
    const scene = new TestScene('game');

    manager.push(scene);

    expect(scene.onEnter).toHaveBeenCalled();
    expect(manager.active).toBe(scene);
  });

  it('push calls onPause on previous scene', () => {
    const manager = new SceneManager();
    const scene1 = new TestScene('game');
    const scene2 = new TestScene('pause');

    manager.push(scene1);
    manager.push(scene2);

    expect(scene1.onPause).toHaveBeenCalled();
    expect(scene2.onEnter).toHaveBeenCalled();
    expect(manager.active).toBe(scene2);
  });

  it('pop calls onExit on removed scene and onResume on previous', () => {
    const manager = new SceneManager();
    const scene1 = new TestScene('game');
    const scene2 = new TestScene('pause');

    manager.push(scene1);
    manager.push(scene2);
    manager.pop();

    expect(scene2.onExit).toHaveBeenCalled();
    expect(scene1.onResume).toHaveBeenCalled();
    expect(manager.active).toBe(scene1);
  });

  it('replace calls onExit on old scene and onEnter on new', () => {
    const manager = new SceneManager();
    const scene1 = new TestScene('level1');
    const scene2 = new TestScene('level2');

    manager.push(scene1);
    manager.replace(scene2);

    expect(scene1.onExit).toHaveBeenCalled();
    expect(scene2.onEnter).toHaveBeenCalled();
    expect(manager.active).toBe(scene2);
  });
});
```

### Mock/Test Utilities

Shipped with `@yage/core` for downstream testing:

```typescript
// packages/core/src/test-utils.ts
import {
  EngineContext,
  EventBus, EventBusKey,
  Logger, LoggerKey, LogLevel,
  QueryCache, QueryCacheKey,
  Process,
} from './index';

/**
 * Create a mock scene with a working EngineContext for unit testing.
 * No renderer, no game loop -- just entity management.
 */
export function createMockScene(name?: string): Scene {
  const context = new EngineContext();
  context.register(EventBusKey, new EventBus());
  context.register(LoggerKey, new Logger({ level: LogLevel.None }));
  context.register(QueryCacheKey, new QueryCache());

  const scene = new TestableScene(name ?? 'mock-scene');
  scene._setContext(context);
  return scene;
}

/**
 * Create a mock entity within a mock scene.
 */
export function createMockEntity(name?: string): Entity {
  const scene = createMockScene();
  return scene.spawn(name ?? 'mock-entity');
}

/**
 * Advance a process by N frames of the given frame duration.
 */
export function advanceFrames(
  process: Process,
  frames: number,
  frameDuration: number = 16.67,
): void {
  for (let i = 0; i < frames; i++) {
    process._update(frameDuration);
  }
}
```

### Test Patterns for Additional Features

#### Asset Loading

```typescript
describe('AssetManager', () => {
  it('loads assets via registered loader', async () => {
    const manager = new AssetManager();
    const mockLoader: AssetLoader<string> = {
      load: vi.fn().mockResolvedValue('loaded-data'),
    };
    manager.registerLoader('test', mockLoader);

    const handle = new AssetHandle<string>('test', 'path/to/asset');
    await manager.loadAll([handle]);

    expect(manager.get(handle)).toBe('loaded-data');
    expect(manager.has(handle)).toBe(true);
  });

  it('reports progress during loadAll', async () => {
    const manager = new AssetManager();
    manager.registerLoader('test', { load: () => Promise.resolve('x') });

    const progress: number[] = [];
    const handles = [
      new AssetHandle('test', 'a'),
      new AssetHandle('test', 'b'),
    ];

    await manager.loadAll(handles, (p) => progress.push(p));
    expect(progress[progress.length - 1]).toBe(1);
  });
});
```

#### Blueprint

```typescript
describe('defineBlueprint', () => {
  it('builds entity with parameters', () => {
    const bp = defineBlueprint<{ hp: number }>('test', (entity, { hp }) => {
      entity.add(new Transform());
      entity.add(new HealthComponent(hp));
    });

    const scene = createMockScene();
    const entity = scene.spawn('e');
    bp.build(entity, { hp: 50 });

    expect(entity.has(Transform)).toBe(true);
    expect(entity.get(HealthComponent).hp).toBe(50);
  });
});
```

#### Entity Events

```typescript
describe('Entity events', () => {
  it('emits and receives typed events', () => {
    const DamageEvent = defineEvent<{ amount: number }>('damage');
    const entity = createMockEntity();
    const handler = vi.fn();

    entity.on(DamageEvent, handler);
    entity.emit(DamageEvent, { amount: 25 });

    expect(handler).toHaveBeenCalledWith({ amount: 25 });
  });

  it('once auto-unsubscribes', () => {
    const HitEvent = defineEvent('hit');
    const entity = createMockEntity();
    const handler = vi.fn();

    entity.once(HitEvent, handler);
    entity.emit(HitEvent);
    entity.emit(HitEvent);

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
```

#### React UI / Store

```typescript
describe('createStore', () => {
  it('notifies subscribers on set', () => {
    const store = createStore({ score: 0 });
    const listener = vi.fn();

    store.subscribe(listener);
    store.set({ score: 10 });

    expect(listener).toHaveBeenCalled();
    expect(store.get().score).toBe(10);
  });

  it('does not notify when value unchanged', () => {
    const store = createStore({ score: 0 });
    const listener = vi.fn();

    store.subscribe(listener);
    store.set({ score: 0 });

    expect(listener).not.toHaveBeenCalled();
  });
});
```

---

## 2. Integration Tests (Playwright)

> **Status**: E2E tests are planned but not yet implemented. The patterns and examples below serve as the target specification.

### Configuration

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
});
```

### Test Convention

E2E tests live in the top-level `e2e/` directory, **not** co-located with packages:

```
e2e/
  bouncing-ball.spec.ts
  input.spec.ts
  physics.spec.ts
  scene-transitions.spec.ts
  ui.spec.ts
  inspector.spec.ts
```

### Core Principle: State Assertions, Not Screenshots

Tests query the Inspector API for structured data. No pixel comparison. This makes tests:
- Deterministic (no rendering variance across platforms)
- Fast (no image diffing)
- Readable (assertions on data, not pixels)
- Agent-friendly (clear pass/fail with meaningful error messages)

### Test Patterns

#### Entity Spawning

```typescript
// e2e/bouncing-ball.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Bouncing Ball', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/bouncing-ball');
    // Wait for engine to start
    await page.waitForFunction(() => window.__yage__?.inspector !== undefined);
  });

  test('ball entity exists with correct components', async ({ page }) => {
    const ball = await page.evaluate(() =>
      window.__yage__.inspector.getEntityByName('ball')
    );

    expect(ball).toBeDefined();
    expect(ball!.components).toContain('Transform');
    expect(ball!.components).toContain('RigidBodyComponent');
    expect(ball!.components).toContain('ColliderComponent');
    expect(ball!.components).toContain('GraphicsComponent');
  });

  test('ball falls due to gravity', async ({ page }) => {
    const initialPos = await page.evaluate(() =>
      window.__yage__.inspector.getEntityPosition('ball')
    );

    await page.waitForTimeout(1000);

    const laterPos = await page.evaluate(() =>
      window.__yage__.inspector.getEntityPosition('ball')
    );

    expect(laterPos!.y).toBeGreaterThan(initialPos!.y);
  });

  test('ball bounces off floor', async ({ page }) => {
    // Wait for ball to fall and bounce
    await page.waitForTimeout(3000);

    const pos = await page.evaluate(() =>
      window.__yage__.inspector.getEntityPosition('ball')
    );

    // Ball should be above the floor (bounced back up or settled)
    expect(pos!.y).toBeLessThan(560); // Floor is at y=580
  });
});
```

#### Physics Collision Events

```typescript
// e2e/physics.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Physics Collisions', () => {
  test('collision events fire between entities', async ({ page }) => {
    await page.goto('/examples/platformer');
    await page.waitForFunction(() => window.__yage__?.inspector !== undefined);

    // Move player into a coin (collectible)
    // Use keyboard to move right
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(2000);
    await page.keyboard.up('KeyD');

    // Check that the coin was collected (destroyed)
    const coin = await page.evaluate(() =>
      window.__yage__.inspector.getEntityByName('coin_1')
    );

    expect(coin).toBeUndefined(); // Coin should be destroyed after collection
  });
});
```

#### Input Handling

```typescript
// e2e/input.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Input System', () => {
  test('keyboard actions are detected', async ({ page }) => {
    await page.goto('/examples/input-demo');
    await page.waitForFunction(() => window.__yage__?.inspector !== undefined);

    // Press jump key
    await page.keyboard.down('Space');

    const jumpState = await page.evaluate(() =>
      window.__yage__.inspector.getComponentData('input-display', 'InputState')
    );

    expect(jumpState).toHaveProperty('jump', true);

    await page.keyboard.up('Space');
  });

  test('mouse position is tracked', async ({ page }) => {
    await page.goto('/examples/input-demo');
    await page.waitForFunction(() => window.__yage__?.inspector !== undefined);

    await page.mouse.move(200, 150);

    const pointerPos = await page.evaluate(() => {
      // InputManager is exposed via the inspector in debug mode
      const snapshot = window.__yage__.inspector.getComponentData('input-display', 'InputState');
      return snapshot?.pointerPosition;
    });

    expect(pointerPos.x).toBeCloseTo(200, -1);
    expect(pointerPos.y).toBeCloseTo(150, -1);
  });
});
```

#### Scene Transitions

```typescript
// e2e/scene-transitions.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Scene Stack', () => {
  test('pushing a scene pauses the one below', async ({ page }) => {
    await page.goto('/examples/scene-stack');
    await page.waitForFunction(() => window.__yage__?.inspector !== undefined);

    let stack = await page.evaluate(() =>
      window.__yage__.inspector.getSceneStack()
    );
    expect(stack).toHaveLength(1);
    expect(stack[0].name).toBe('game');

    // Press pause key to push pause scene
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    stack = await page.evaluate(() =>
      window.__yage__.inspector.getSceneStack()
    );
    expect(stack).toHaveLength(2);
    expect(stack[1].name).toBe('pause');
    expect(stack[0].paused).toBe(true);

    // Press escape again to pop
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    stack = await page.evaluate(() =>
      window.__yage__.inspector.getSceneStack()
    );
    expect(stack).toHaveLength(1);
    expect(stack[0].paused).toBe(false);
  });
});
```

#### Inspector API

```typescript
// e2e/inspector.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Inspector API', () => {
  test('snapshot returns correct engine state', async ({ page }) => {
    await page.goto('/examples/bouncing-ball');
    await page.waitForFunction(() => window.__yage__?.inspector !== undefined);

    const snapshot = await page.evaluate(() =>
      window.__yage__.inspector.snapshot()
    );

    expect(snapshot.frameCount).toBeGreaterThan(0);
    expect(snapshot.entityCount).toBeGreaterThan(0);
    expect(snapshot.sceneStack).toHaveLength(1);
    expect(snapshot.sceneStack[0].name).toBe('bounce');
  });

  test('structured logs are accessible', async ({ page }) => {
    await page.goto('/examples/bouncing-ball');
    await page.waitForFunction(() => window.__yage__?.inspector !== undefined);
    await page.waitForTimeout(500);

    const logs = await page.evaluate(() =>
      window.__yage__.logger.formatRecentLogs(10)
    );

    expect(typeof logs).toBe('string');
    expect(logs.length).toBeGreaterThan(0);
  });
});
```

---

## 3. Inspector API Design

The Inspector is the bridge between the game engine and external tools (Playwright tests, browser console, debug UI, AI agents).

### API Surface

| Method | Returns | Description |
|---|---|---|
| `snapshot()` | `EngineSnapshot` | Full engine state: frame count, scene stack, entity count, system count, errors |
| `getEntityByName(name)` | `EntitySnapshot \| undefined` | Find entity by name in the active scene |
| `getEntityPosition(name)` | `{x, y} \| undefined` | Shortcut for entity's Transform position |
| `hasComponent(entityName, componentClass)` | `boolean` | Check component presence |
| `getComponentData(entityName, componentClass)` | `unknown` | Serializable component state |
| `getEntities()` | `EntitySnapshot[]` | All entities in the active scene |
| `getSceneStack()` | `SceneSnapshot[]` | Scene stack info |
| `getSystems()` | `SystemSnapshot[]` | Active system info with timing |
| `getErrors()` | `ErrorSnapshot` | Disabled systems/components from error boundary |

### Exposure

In debug mode (`Engine({ debug: true })`), the Inspector is exposed on `window.__yage__`:

```typescript
// Set up by Engine on start
if (config.debug && typeof window !== 'undefined') {
  (window as any).__yage__ = {
    inspector: this.inspector,
    logger: this.logger,
    context: this.context,
  };
}
```

### Type Declaration for Playwright

```typescript
// e2e/global.d.ts
import type { Inspector, Logger, EngineContext } from '@yage/core';

declare global {
  interface Window {
    __yage__?: {
      inspector: Inspector;
      logger: Logger;
      context: EngineContext;
    };
  }
}
```

---

## 4. Structured Logging for Agents

### Design Goals

1. **Structured**: Each log entry is a typed object (`LogEntry`), not a free-form string.
2. **Categorized**: Filter by system (physics, input, render, ai, core) to reduce noise.
3. **Bounded**: Ring buffer prevents memory growth. Default 500 entries.
4. **Readable**: `formatRecentLogs()` outputs concise, parseable text.

### Format Specification

```
[LEVEL][category] fNNN message {data}
```

- `LEVEL`: DEBUG, INFO, WARN, ERROR
- `category`: lowercase identifier (e.g., physics, input, core, ai, render)
- `fNNN`: frame number (monotonically increasing)
- `message`: human-readable description
- `{data}`: optional JSON-like key:value pairs (single line)

### Examples

```
[INFO][core] f0 Engine started {plugins:["renderer","physics","input"]}
[INFO][core] f0 Scene pushed {scene:"game"}
[DEBUG][physics] f1 Body created {entity:"ball", type:"dynamic"}
[DEBUG][physics] f1 Collider created {entity:"ball", shape:"circle", radius:20}
[INFO][physics] f45 Collision detected {a:"ball", b:"floor", started:true}
[WARN][render] f120 Missing texture {entity:"particle_99", alias:"spark.png"}
[ERROR][core] f200 Component threw in onAdd {entity:"broken", component:"BadComponent", error:"x is undefined"}
```

### Agent Usage Pattern

An AI coding agent debugging a game can:

```typescript
// In Playwright or browser console
const logs = window.__yage__.logger.formatRecentLogs(50);
// Parse for errors
const errorLines = logs.split('\n').filter(l => l.startsWith('[ERROR]'));
// Check physics events
const physicsLines = logs.split('\n').filter(l => l.includes('[physics]'));
```

---

## 5. CI Pipeline

### GitHub Actions Workflow

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npx turbo lint
      - run: npx turbo typecheck

  unit-tests:
    runs-on: ubuntu-latest
    needs: lint-and-typecheck
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npx turbo test -- --coverage
      - uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: packages/*/coverage/

  build:
    runs-on: ubuntu-latest
    needs: unit-tests
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npx turbo build

  e2e-tests:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npx turbo build
      - run: npx playwright install chromium
      - run: npx playwright test
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

### Pipeline Order

```
lint → typecheck → unit tests (with coverage) → build → e2e tests
```

All steps are required to pass before a PR can merge.

---

## 6. Test File Conventions Summary

| Type | Location | Runner | Environment |
|---|---|---|---|
| Unit tests | `packages/*/src/*.test.ts` | Vitest | Node.js |
| Test utilities | `packages/core/src/test-utils.ts` | -- | Importable |
| E2E tests | `e2e/*.spec.ts` | Playwright | Chromium |
| E2E types | `e2e/global.d.ts` | -- | Type declarations |
| CI config | `.github/workflows/ci.yml` | GitHub Actions | Ubuntu |

---

## References

- [TDD.md](./TDD.md) -- Inspector and Logger API specifications
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) -- When tests are written per phase
- [AGENT_GUIDE.md](./AGENT_GUIDE.md) -- How agents use testing infrastructure
- [PLUGIN_ARCHITECTURE.md](./PLUGIN_ARCHITECTURE.md) -- Plugin testing patterns
