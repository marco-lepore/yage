# Agent Guide for YAGE Development

This guide is specifically designed for AI agents working on the YAGE codebase. It provides essential information for understanding, navigating, and modifying the codebase effectively.

## Quick Reference

### Project Overview
- **Name**: YAGE (Yet Another Game Engine)
- **Language**: TypeScript
- **Purpose**: Component-based 2D game engine for the browser
- **Primary Dependencies**: PixiJS (rendering), Rapier2D (physics), XState (state machines)
- **Build Tool**: Vite
- **Test Framework**: Vitest

### Key Commands
```bash
npm run dev           # Start development server
npm run build         # Build all targets
npm run build:watch   # Build in watch mode
npm test              # Run tests
npm run lint          # Lint code
npm run docs          # Generate documentation
```

## Codebase Navigation

### Entry Points

1. **Main Export**: `src/index.ts`
   - All public APIs are exported from here
   - Start here to understand what's exposed to users

2. **Examples**: `examples/*/main.ts`
   - Real-world usage examples
   - Start here to understand typical usage patterns

### Core Files to Understand

| File | Purpose | Priority |
|------|---------|----------|
| `src/Game/index.ts` | Game initialization and management | High |
| `src/Scene/index.ts` | Scene lifecycle and management | High |
| `src/GameObject/index.ts` | GameObject base class | High |
| `src/components/BaseComponent/index.ts` | Component base class | High |
| `src/Process/index.ts` | Process/coroutine system | Medium |
| `src/Executor/index.ts` | Context management | Medium |
| `src/Scene/Rapier.ts` | Physics integration | Medium |
| `src/utils/index.ts` | Utility functions | Low |

## Architecture Quick Reference

### Class Hierarchy

```
Game
└── Scene
    └── GameObject
        └── Component
```

### Lifecycle Flow

```
Game.init()
  ↓
Game.loadScene(scene)
  ↓
Scene.load() → Scene.onLoad()
  ↓
Scene.instantiateGameObject()
  ↓
GameObject.constructor() → GameObject.onAdded()
  ↓
GameObject.addComponent()
  ↓
Component.constructor() → Component.onAdded()
  ↓
[Game Loop]
  Scene.onBeforeTick()
    → GameObject.onBeforeTick()
      → Component.onBeforeTick()
  Scene.onTick()
    → Physics simulation
      → Scene.onBeforeFixedTick()
      → Scene.onFixedTick()
      → Scene.onAfterFixedTick()
    → GameObject.onTick()
      → Component.onTick()
  Scene.onAfterTick()
    → GameObject.onAfterTick()
      → Component.onAfterTick()
```

## Common Modifications

### 1. Adding a New Component

**Location**: `src/components/YourComponent/index.ts`

**Template**:
```typescript
import { Component } from '../BaseComponent'
import { GameObject } from '../../GameObject'

export class YourComponent extends Component<GameObject> {
  name = 'your-component'

  // Optional: Custom constructor parameters
  constructor(
    parent: GameObject,
    private options: YourOptions
  ) {
    super(parent)
  }

  // Called when added to GameObject
  onAdded() {
    // Setup logic
  }

  // Called every frame
  onTick(dt: number) {
    // Update logic
  }

  // Called every physics step (fixed timestep)
  onFixedTick(elapsedMS: number) {
    // Physics logic
  }

  // Cleanup
  private teardown() {
    // Cleanup logic
  }
}
```

**Don't forget to**:
1. Export from `src/components/index.ts`
2. Add to main export in `src/index.ts`
3. Add tests
4. Add example usage

### 2. Adding a New GameObject

**Location**: `src/premade/gameobjects/YourGameObject/index.ts` or user code

**Template**:
```typescript
import { GameObject } from '../../GameObject'
import { Scene } from '../../Scene'
import { YourComponent } from '../../components'

export class YourGameObject<S extends Scene = Scene> extends GameObject<S> {
  constructor(scene: S, ...params: any[]) {
    super(scene)

    this.name = 'your-object'
    this.tags = ['your-tag']

    // Add components
    this.addComponent(YourComponent, params)
  }

  onAdded() {
    // Called when added to scene
  }
}
```

### 3. Adding a New Scene

**Location**: `src/premade/scenes/YourScene.ts` or user code

**Template**:
```typescript
import { Scene } from '../../Scene'

interface YourSceneState {
  // Define state properties
}

interface YourSceneEvents {
  // Define event types
  'custom-event': CustomEvent
}

export class YourScene extends Scene<YourSceneState, YourSceneEvents> {
  // Asset bundle for this scene
  assetsBundle = {
    'asset-id': 'path/to/asset.png',
  }

  constructor() {
    super({ /* initial state */ })
  }

  onLoad() {
    super.onLoad()
    // Scene setup after assets load
  }

  onTick(dt: number) {
    super.onTick(dt)
    // Custom update logic
  }

  onTransitionCompleted() {
    // Called after scene transition completes
  }
}
```

### 4. Adding a Utility Function

**Location**: `src/utils/yourUtility.ts`

**Template**:
```typescript
/**
 * Description of what the utility does
 *
 * @param param1 - Description
 * @param param2 - Description
 * @returns Description of return value
 */
export function yourUtility(param1: Type1, param2: Type2): ReturnType {
  // Implementation
}
```

**Don't forget to**: Export from `src/utils/index.ts`

### 5. Adding an Example

**Location**: `examples/your-example/`

**Structure**:
```
examples/your-example/
├── index.html
├── main.ts
├── style.css
└── Scene/
    └── YourScene.ts
```

**main.ts template**:
```typescript
import './style.css'
import { Game, Executor } from '../../src/index'
import { YourScene } from './Scene/YourScene'

const game = new Game({
  width: 800,
  height: 600,
})

const scene = new YourScene()
const g = await Executor.execute(game)
g.loadScene(scene)
```

## Code Patterns

### Pattern 1: Querying Objects

```typescript
// In Scene
const player = this.getGameObjectByTag('player')
const enemies = this.getGameObjectsByClass(Enemy)
const ui = this.getGameObjectByName('ui-manager')

// In GameObject
const physics = this.getComponentByClass(RapierBodyComponent)
const graphics = this.getComponentByTag('renderable')
```

**Important**: Don't query in hot loops (onTick, onFixedTick) - cache results

### Pattern 2: Creating Processes

```typescript
import { Process } from '../Process'

// Timer
Process.spawnTimer(1000, ({ progress }) => {
  console.log('Timer done!')
})

// Interval
Process.spawnInterval(1000, () => {
  console.log('Tick!')
})

// Tween
Process.tweenProperty(sprite, 'x', 100, 1000)

// Custom process
Process.spawn({
  duration: 1000,
  setup: () => ({ value: 0 }),
  onTick: ({ context, progress, elapsed }) => {
    context.value += elapsed
  },
  onComplete: () => {
    console.log('Done!')
  }
})
```

### Pattern 3: Physics Integration

```typescript
import { RigidBodyDesc, ColliderDesc } from '@dimforge/rapier2d'
import { RapierBodyComponent, GraphicComponent } from '../components'
import { pu } from '../utils'

// In GameObject constructor
const [px, py] = pu(x, y) // Convert pixels to physics units
const rigidBody = RigidBodyDesc.dynamic().setTranslation(px, py)
const collider = ColliderDesc.ball(radius).setRestitution(0.8)
const physics = this.addComponent(RapierBodyComponent, rigidBody, collider)

// Link graphics to physics
this.addComponent(GraphicComponent, {
  graphic: myGraphic,
  linkedTransform: physics.transform
})
```

### Pattern 4: Event Dispatching

```typescript
// Define event type in Scene
interface MySceneEvents {
  'player-died': CustomEvent<{ score: number }>
}

// Dispatch event
this.dispatch(new CustomEvent('player-died', { detail: { score: 100 } }))

// Listen to event
this.addEventListener('player-died', (event) => {
  console.log('Score:', event.detail.score)
})
```

### Pattern 5: Asset Loading

```typescript
// In Scene class
class MyScene extends Scene {
  assetsBundle = {
    'player': 'assets/player.png',
    'enemy': 'assets/enemy.png',
    'music': 'assets/music.mp3',
  }

  async load(onProgress?: (progress: number) => void) {
    await super.load(onProgress)
    // Assets are loaded and cached
  }

  onLoad() {
    super.onLoad()
    // Use assets via Assets.cache.get() or directly in components
  }
}
```

## Important Context

### Coordinate Systems

1. **Pixel Coordinates**: Used for rendering (PixiJS)
2. **Physics Coordinates**: Used for Rapier physics simulation
3. **Conversion**: Use `pu()` utility to convert pixels to physics units

```typescript
import { pu } from '../utils'

// Convert pixels to physics units
const [physicsX, physicsY] = pu(pixelX, pixelY)
```

### Process Modes

GameObjects can have different process modes:

```typescript
gameObject.processMode = 'pausable'   // Default: pause with scene
gameObject.processMode = 'always'     // Always process
gameObject.processMode = 'whenPaused' // Only when paused
```

### Context Management

Use `Executor` to access current game/scene:

```typescript
import { Executor } from '../Executor'

const { game, scene } = Executor.ctx

// Or use utility
import { getScene } from '../utils'
const scene = getScene()
```

## Testing Guidelines

### Component Tests

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { YourComponent } from './index'
import { GameObject } from '../../GameObject'
import { Scene } from '../../Scene'

describe('YourComponent', () => {
  let scene: Scene
  let gameObject: GameObject

  beforeEach(() => {
    scene = new Scene({})
    gameObject = new GameObject(scene)
  })

  it('should initialize correctly', () => {
    const component = new YourComponent(gameObject)
    expect(component.name).toBe('your-component')
  })

  it('should handle tick updates', () => {
    const component = new YourComponent(gameObject)
    gameObject.registerComponents(component)

    component.onTick(16.67)
    // Assert expected behavior
  })
})
```

### Scene Tests

```typescript
import { describe, it, expect } from 'vitest'
import { YourScene } from './YourScene'

describe('YourScene', () => {
  it('should initialize with correct state', () => {
    const scene = new YourScene()
    expect(scene.getState()).toEqual({ /* expected state */ })
  })

  it('should load assets', async () => {
    const scene = new YourScene()
    await scene.load()
    // Assert assets are loaded
  })
})
```

## Common Pitfalls

### 1. Forgetting to call super

```typescript
// ❌ Wrong
onLoad() {
  this.setupScene()
}

// ✅ Correct
onLoad() {
  super.onLoad()
  this.setupScene()
}
```

### 2. Querying in hot loops

```typescript
// ❌ Wrong - queries every frame
onTick(dt: number) {
  const player = this.scene.getGameObjectByTag('player')
  // ...
}

// ✅ Correct - cache reference
onAdded() {
  this.player = this.scene.getGameObjectByTag('player')
}

onTick(dt: number) {
  if (this.player) {
    // Use cached reference
  }
}
```

### 3. Memory leaks from event listeners

```typescript
// ❌ Wrong - no cleanup
onAdded() {
  this.scene.addEventListener('event', this.handler)
}

// ✅ Correct - cleanup in teardown
private removeListener?: () => void

onAdded() {
  this.removeListener = this.scene.addEventListener('event', this.handler)
}

private teardown() {
  this.removeListener?.()
}
```

### 4. Not cleaning up Processes

```typescript
// ❌ Wrong - process continues after component destroyed
onAdded() {
  Process.spawn({ duration: 10000, onTick: () => { /* ... */ } })
}

// ✅ Correct - destroy process with component
private process?: Process

onAdded() {
  this.process = Process.spawn({ duration: 10000, onTick: () => { /* ... */ } })
}

private teardown() {
  this.process?.destroy()
}
```

### 5. Modifying arrays during iteration

```typescript
// ❌ Wrong
this.gameObjects.forEach(go => {
  if (condition) {
    this.removeGameObjects(go) // Modifies array during iteration
  }
})

// ✅ Correct
const toRemove = this.gameObjects.filter(go => condition)
this.removeGameObjects(...toRemove)
```

## File Organization Rules

### Component Files
- Location: `src/components/ComponentName/index.ts`
- One component per directory
- Export from `src/components/index.ts`

### GameObject Files
- Location: `src/premade/gameobjects/GameObjectName/index.ts`
- Export from `src/premade/gameobjects/index.ts`

### Scene Files
- Location: `src/premade/scenes/SceneName.ts`
- Export from `src/premade/scenes/index.ts`

### Utility Files
- Location: `src/utils/utilityName.ts`
- Export from `src/utils/index.ts`

### Test Files
- Location: Co-located with source (e.g., `index.test.ts`)
- Use Vitest

## Build Targets

The project builds to multiple targets:

1. **ESM** (`dist/esm/`): ES Modules for modern bundlers
2. **CJS** (`dist/cjs/`): CommonJS for Node.js
3. **Types** (`dist/types/`): TypeScript declarations

Each target has its own `tsconfig`:
- `tsconfig.esm.json`
- `tsconfig.cjs.json`
- `tsconfig.types.json`

## Quick Debugging Tips

### Runtime Errors

1. Check if `Executor.ctx` is set
2. Verify `scene` and `game` are initialized
3. Check asset loading completed
4. Verify component initialization order

### Build Errors

1. Check all exports are correct
2. Verify TypeScript types
3. Check circular dependencies
4. Clear `dist/` and rebuild

### Physics Issues

1. Check `pixelToMeterRatio` is set correctly
2. Verify collider positions and sizes
3. Check rigid body types (dynamic/static/kinematic)
4. Ensure transforms are linked correctly

## Performance Optimization

### Key Areas

1. **Object Pooling**: Use for frequently created objects
2. **Caching**: Cache component/GameObject queries
3. **Batching**: Group similar draw calls
4. **Asset Loading**: Use loading screens for large bundles
5. **Process Management**: Clean up unused processes

### Profiling

- Use browser DevTools Performance tab
- Check frame timing in Ticker
- Monitor memory usage
- Profile physics step cost

## Integration with External Libraries

### PixiJS
- Primary rendering engine
- Documentation: https://pixijs.com/docs
- Access via `game.app` or components

### Rapier2D
- Physics engine
- Documentation: https://rapier.rs/docs/
- Access via `scene.rapier`

### XState
- State machine library
- Documentation: https://xstate.js.org/docs/
- Used in FSMComponent

## Versioning and Releases

- Follow semantic versioning (semver)
- Update `package.json` version
- Update CHANGELOG.md
- Create git tag
- Build all targets before release

## Summary Checklist

When modifying the codebase:

- [ ] Understand the modification's place in the architecture
- [ ] Follow existing code patterns
- [ ] Add/update TypeScript types
- [ ] Call `super` methods where required
- [ ] Clean up resources in teardown methods
- [ ] Add tests for new functionality
- [ ] Update exports if adding new public APIs
- [ ] Add JSDoc documentation
- [ ] Update relevant documentation files
- [ ] Test build targets (`npm run build`)
- [ ] Run tests (`npm test`)
- [ ] Run linter (`npm run lint`)
- [ ] Add example if introducing new feature

## Additional Resources

- **ARCHITECTURE.md**: Detailed architectural documentation
- **CONTRIBUTING.md**: Contribution guidelines
- **Examples**: `examples/` directory
- **Source code**: `src/` directory with inline comments
- **Generated docs**: Run `npm run docs`

## Questions to Ask

When uncertain about a modification:

1. Does this follow the existing architecture patterns?
2. Is this the right layer (Game/Scene/GameObject/Component)?
3. Are there existing utilities I can reuse?
4. How will this affect performance?
5. What are the lifecycle implications?
6. Are there existing examples I can reference?
7. Does this need to be configurable?
8. How should this be tested?

---

This guide should provide sufficient context for effective development on the YAGE codebase. Refer to ARCHITECTURE.md for deeper architectural details and CONTRIBUTING.md for process guidelines.
