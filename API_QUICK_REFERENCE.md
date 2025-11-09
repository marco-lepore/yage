# YAGE API Quick Reference

Quick reference for the most commonly used YAGE APIs.

## Game

```typescript
import { Game, Executor } from 'yage'

// Create game
const game = new Game({
  width: 800,
  height: 600,
  virtualWidth: 320,   // Optional: logical width
  virtualHeight: 240,  // Optional: logical height
})

// Initialize
await Executor.execute(game)

// Load scene
await game.loadScene(myScene)

// Transition to scene
await game.transitionTo(newScene, duration)

// Load assets
await game.loadAssets(assetsBundle, 'bundle-name')

// Access PixiJS app
game.app

// Access current scene
game.scene

// Access player input
game.playerInput['KeyW'] // true if pressed
```

## Scene

```typescript
import { Scene } from 'yage'

class MyScene extends Scene<StateType, EventsType> {
  // Asset bundle
  assetsBundle = {
    'sprite': 'path/to/sprite.png',
  }

  constructor() {
    super(initialState)
  }

  // Load assets
  async load(onProgress?: (progress: number) => void) {
    await super.load(onProgress)
  }

  // Setup after load
  onLoad() {
    super.onLoad()
  }

  // Lifecycle hooks
  onTick(dt: number) { super.onTick(dt) }
  onBeforeTick(dt: number) { super.onBeforeTick(dt) }
  onAfterTick(dt: number) { super.onAfterTick(dt) }
  onFixedTick(dt: number) { super.onFixedTick(dt) }
  onBeforeFixedTick(dt: number) { super.onBeforeFixedTick(dt) }
  onAfterFixedTick(dt: number) { super.onAfterFixedTick(dt) }

  // GameObject management
  instantiateGameObject(ctor, ...params)
  addGameObjects(...gameObjects)
  removeGameObjects(...gameObjects)

  // Queries
  getGameObjectByClass(ctor)
  getGameObjectByName(name)
  getGameObjectByTag(tag)
  getGameObjectsByClass(ctor)
  getGameObjectsByName(name)
  getGameObjectsByTag(tag)

  // State
  getState()
  this.state // Direct access

  // Events
  dispatch(event)
  addEventListener(type, callback)

  // Display
  this.display // PixiJS Container

  // Physics
  this.rapier.world
  this.rapier.pixelToMeterRatio = 10

  // Control
  this.paused = true/false
  this.ticker.start()
  this.ticker.stop()
}
```

## GameObject

```typescript
import { GameObject } from 'yage'

class MyObject extends GameObject<SceneType> {
  constructor(scene: SceneType, ...params) {
    super(scene)

    this.name = 'my-object'
    this.tags = ['tag1', 'tag2']
    this.processMode = 'pausable' // or 'always' or 'whenPaused'

    // Add components
    this.addComponent(ComponentClass, ...params)
  }

  // Lifecycle
  onAdded() {}
  onTick(dt: number) {}
  onBeforeTick(dt: number) {}
  onAfterTick(dt: number) {}
  onFixedTick(dt: number) {}
  onBeforeFixedTick(dt: number) {}
  onAfterFixedTick(dt: number) {}

  // Component management
  addComponent(ctor, ...params)
  registerComponents(...components)
  unregisterComponent(...components)

  // Queries
  getComponentByClass(ctor)
  getComponentByName(name)
  getComponentByTag(tag)
  getComponentsByClass(ctor)
  getComponentsByName(name)
  getComponentsByTag(tag)

  // Scene events
  dispatchSceneEvent(event)

  // Destruction
  destroy()
  queueDestroy() // Destroy at end of frame
}
```

## Component

```typescript
import { Component } from 'yage'

class MyComponent extends Component<GameObjectType> {
  name = 'my-component'
  tags = ['tag1']

  constructor(parent: GameObjectType, ...params) {
    super(parent)
  }

  // Lifecycle
  onAdded() {}
  onRemoved() {}
  onTick(dt: number) {}
  onBeforeTick(dt: number) {}
  onAfterTick(dt: number) {}
  onFixedTick(dt: number) {}
  onBeforeFixedTick(dt: number) {}
  onAfterFixedTick(dt: number) {}

  // Access parent
  this.parent // GameObject

  // Enable/disable
  this.enabled = true/false
  isEnabled()

  // Cleanup
  destroy()
}
```

## Process

```typescript
import { Process } from 'yage'

// Timer
const timer = Process.spawnTimer(1000, ({ progress }) => {
  console.log('Done!')
})

// Interval
const interval = Process.spawnInterval(1000, () => {
  console.log('Tick!')
})

// Tween
const tween = Process.tween(
  (value) => { sprite.x = value },
  0,    // from
  100,  // to
  1000, // duration
  'easeInOut' // optional easing
)

// Tween property
const propTween = Process.tweenProperty(
  sprite,
  'x',
  100,
  1000,
  'easeInOut'
)

// Generic process
const process = Process.spawn({
  duration: 1000,
  loop: false,
  tags: ['animation'],
  setup: () => ({ value: 0 }), // Optional setup function
  onTick: ({ totalElapsed, progress, elapsed, context }) => {
    // Update
  },
  onComplete: ({ progress, context }) => {
    // Complete
  }
})

// Control
process.pause()
process.resume()
process.destroy()

// Await
await process.toPromise()
```

## Components Library

### GraphicComponent

```typescript
import { GraphicComponent } from 'yage'
import { Graphics, Sprite } from 'pixi.js'

const graphic = new Graphics()
graphic.beginFill(0xFF0000)
graphic.drawCircle(0, 0, 20)
graphic.endFill()

gameObject.addComponent(GraphicComponent, {
  graphic: graphic,
  linkedTransform?: transform, // Optional: sync with transform
  zIndex?: 0,
})
```

### AnimatedGraphicComponent

```typescript
import { AnimatedGraphicComponent } from 'yage'

gameObject.addComponent(AnimatedGraphicComponent, {
  animations: {
    'idle': [texture1, texture2],
    'walk': [texture3, texture4],
  },
  initialAnimation: 'idle',
  animationSpeed: 0.1,
})

const anim = gameObject.getComponentByClass(AnimatedGraphicComponent)
anim.play('walk')
anim.stop()
```

### RapierBodyComponent

```typescript
import { RapierBodyComponent } from 'yage'
import { RigidBodyDesc, ColliderDesc } from '@dimforge/rapier2d'
import { pu } from 'yage'

const [px, py] = pu(x, y)
const rigidBody = RigidBodyDesc.dynamic().setTranslation(px, py)
const collider = ColliderDesc.ball(radius)

const physics = gameObject.addComponent(
  RapierBodyComponent,
  rigidBody,
  collider
)

// Access
physics.rigidBody
physics.collider
physics.transform
```

### AudioComponent

```typescript
import { AudioComponent } from 'yage'

const audio = gameObject.addComponent(AudioComponent, {
  sound: 'sound-id', // Asset ID
  volume: 1.0,
  loop: false,
})

audio.play()
audio.stop()
audio.pause()
```

### ParticlesEmitterComponent

```typescript
import { ParticlesEmitterComponent } from 'yage'

const particles = gameObject.addComponent(
  ParticlesEmitterComponent,
  emitterConfig, // Particle emitter config object
  textures       // Array of textures
)

particles.emitter.emit = true
```

### InputComponent

```typescript
import { InputComponent } from 'yage'

const input = gameObject.addComponent(InputComponent, {
  bindings: {
    'jump': ['Space', 'KeyW'],
    'shoot': ['KeyJ'],
  }
})

input.isActionPressed('jump')
input.isActionJustPressed('jump')
input.isActionJustReleased('jump')
```

### FSMComponent

```typescript
import { FSMComponent } from 'yage'
import { createMachine } from 'xstate'

const machine = createMachine({
  initial: 'idle',
  states: {
    idle: { on: { WALK: 'walking' } },
    walking: { on: { STOP: 'idle' } },
  }
})

const fsm = gameObject.addComponent(FSMComponent, machine)

fsm.send('WALK')
fsm.state.value // Current state
```

### TilemapComponent

```typescript
import { TilemapComponent } from 'yage'

const tilemap = gameObject.addComponent(TilemapComponent, {
  tilemapData: data,
  tilesets: tilesets,
})
```

### UI Components

```typescript
import { UITextComponent, UIButtonComponent } from 'yage'

// Text
const text = gameObject.addComponent(UITextComponent, {
  text: 'Hello',
  style: { fontSize: 24, fill: 0xFFFFFF },
})

// Button
const button = gameObject.addComponent(UIButtonComponent, {
  text: 'Click Me',
  onClick: () => { console.log('Clicked!') },
})
```

## Utilities

```typescript
import {
  pu,                    // Pixel units conversion
  getScene,              // Get current scene
  getGame,               // Get current game
  delayP,                // Promise delay
  interpolate,           // Interpolate values
  clamp,                 // Clamp value
  randomRange,           // Random in range
  Vector2D,              // 2D vector utilities
  getPlayAreaBounds,     // Get play area
} from 'yage'

// Pixel units
const [px, py] = pu(100, 100)

// Scene/Game access
const scene = getScene()
const game = getGame()

// Delay
await delayP(1000)

// Interpolation
const value = interpolate(0, 100, 0.5, 'linear')

// Clamp
const clamped = clamp(value, 0, 100)

// Random
const random = randomRange(0, 100)

// Vector
const vec = new Vector2D(x, y)
vec.add(other)
vec.normalize()
vec.magnitude()
```

## Event Types

```typescript
// Define scene events
interface MyEvents {
  'custom-event': CustomEvent<{ data: string }>
}

class MyScene extends Scene<State, MyEvents> {
  someMethod() {
    // Dispatch
    this.dispatch(new CustomEvent('custom-event', {
      detail: { data: 'value' }
    }))

    // Listen
    this.addEventListener('custom-event', (event) => {
      console.log(event.detail.data)
    })
  }
}
```

## Common Patterns

### Creating a Player

```typescript
import { GameObject, GraphicComponent, RapierBodyComponent, InputComponent } from 'yage'
import { RigidBodyDesc, ColliderDesc } from '@dimforge/rapier2d'
import { Graphics } from 'pixi.js'
import { pu } from 'yage'

class Player extends GameObject {
  constructor(scene: Scene, x: number, y: number) {
    super(scene)

    this.name = 'player'
    this.tags = ['player']

    // Physics
    const [px, py] = pu(x, y)
    const body = RigidBodyDesc.dynamic().setTranslation(px, py)
    const collider = ColliderDesc.ball(1)
    const physics = this.addComponent(RapierBodyComponent, body, collider)

    // Graphics
    const graphic = new Graphics()
    graphic.beginFill(0x00FF00)
    graphic.drawCircle(0, 0, 20)
    this.addComponent(GraphicComponent, {
      graphic,
      linkedTransform: physics.transform
    })

    // Input
    this.addComponent(InputComponent, {
      bindings: {
        'left': ['KeyA', 'ArrowLeft'],
        'right': ['KeyD', 'ArrowRight'],
        'jump': ['Space'],
      }
    })
  }

  onFixedTick(dt: number) {
    const input = this.getComponentByClass(InputComponent)
    const physics = this.getComponentByClass(RapierBodyComponent)

    if (input.isActionPressed('left')) {
      physics.rigidBody.applyImpulse({ x: -10, y: 0 }, true)
    }
    if (input.isActionPressed('right')) {
      physics.rigidBody.applyImpulse({ x: 10, y: 0 }, true)
    }
    if (input.isActionJustPressed('jump')) {
      physics.rigidBody.applyImpulse({ x: 0, y: -100 }, true)
    }
  }
}
```

### Scene with State

```typescript
interface GameState {
  score: number
  lives: number
  level: number
}

interface GameEvents {
  'score-changed': CustomEvent<{ score: number }>
  'game-over': CustomEvent
}

class GameScene extends Scene<GameState, GameEvents> {
  constructor() {
    super({ score: 0, lives: 3, level: 1 })
  }

  addScore(points: number) {
    this.state.score += points
    this.dispatch(new CustomEvent('score-changed', {
      detail: { score: this.state.score }
    }))
  }

  onLoad() {
    super.onLoad()

    this.addEventListener('score-changed', (e) => {
      console.log('New score:', e.detail.score)
    })
  }
}
```

### Loading Scene with Progress

```typescript
import { Scene } from 'yage'

class LoadingScene extends Scene {
  targetScene: Scene

  constructor(targetScene: Scene) {
    super({})
    this.targetScene = targetScene
  }

  async onLoad() {
    super.onLoad()

    // Preload target scene
    await this.targetScene.preload((progress) => {
      console.log('Loading:', Math.floor(progress * 100) + '%')
    })

    // Transition to target
    const game = getGame()
    await game.transitionTo(this.targetScene)
  }
}
```

## Physics Quick Reference

```typescript
import { RigidBodyDesc, ColliderDesc, Vector2 } from '@dimforge/rapier2d'

// Rigid bodies
const dynamic = RigidBodyDesc.dynamic()
const static = RigidBodyDesc.fixed()
const kinematic = RigidBodyDesc.kinematicPositionBased()

// Colliders
const ball = ColliderDesc.ball(radius)
const box = ColliderDesc.cuboid(halfWidth, halfHeight)
const capsule = ColliderDesc.capsule(halfHeight, radius)

// Properties
body.setTranslation(x, y)
body.setRotation(angle)
collider.setRestitution(0.8) // Bounciness
collider.setFriction(0.5)
collider.setDensity(1.0)

// Forces
rigidBody.applyImpulse(new Vector2(x, y), true)
rigidBody.applyForce(new Vector2(x, y), true)
rigidBody.setLinvel(new Vector2(x, y), true)

// Scene physics
scene.rapier.pixelToMeterRatio = 10
scene.rapier.world.gravity = new Vector2(0, 9.81)
```

## Tips

1. Always call `super` in lifecycle methods
2. Cache GameObject/Component queries, don't query in loops
3. Use `pu()` to convert pixel coordinates to physics units
4. Clean up processes and event listeners in teardown
5. Use process modes to control pause behavior
6. Prefer composition (components) over inheritance
7. Use TypeScript types for better IDE support
8. Check examples for real-world patterns
