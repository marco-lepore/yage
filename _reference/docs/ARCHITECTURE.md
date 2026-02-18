# YAGE Architecture Documentation

This document provides a detailed overview of YAGE's architecture for developers and AI agents working on the codebase.

## Architecture Overview

YAGE follows a component-based architecture inspired by Entity-Component-System (ECS) patterns, combined with object-oriented principles.

### High-Level Architecture

```
┌─────────────────────────────────────────────┐
│                   Game                      │
│  - PixiJS Application                       │
│  - Virtual Screen Management                │
│  - Scene Loading/Transitions                │
└──────────────┬──────────────────────────────┘
               │
               │ manages
               ▼
┌─────────────────────────────────────────────┐
│                  Scene                      │
│  - Game Loop (Ticker)                       │
│  - Physics (Rapier)                         │
│  - Asset Loading                            │
│  - GameObject Management                    │
│  - Event System                             │
└──────────────┬──────────────────────────────┘
               │
               │ contains multiple
               ▼
┌─────────────────────────────────────────────┐
│               GameObject                    │
│  - Component Container                      │
│  - Lifecycle Management                     │
│  - Process Mode (pausable/always/etc)       │
└──────────────┬──────────────────────────────┘
               │
               │ contains multiple
               ▼
┌─────────────────────────────────────────────┐
│               Component                     │
│  - Modular Functionality                    │
│  - Lifecycle Hooks                          │
│  - Enable/Disable State                     │
└─────────────────────────────────────────────┘
```

## Core Systems

### 1. Game System

**Location**: `src/Game/index.ts`

The `Game` class is the entry point and manages:
- PixiJS Application initialization
- Virtual screen resolution and scaling
- Player input events (keyboard)
- Scene loading and transitions
- Asset loading

**Key Methods**:
- `init()`: Initialize the game and load Rapier physics
- `loadScene()`: Load and display a scene
- `transitionTo()`: Transition between scenes with animations
- `loadAssets()`: Load asset bundles

**Virtual Screen System**:
The game supports virtual resolution with automatic scaling. Set `virtualWidth` and `virtualHeight` to define the game's logical resolution, which is then scaled to fit the actual canvas.

### 2. Scene System

**Location**: `src/Scene/index.ts`

The `Scene` class manages:
- Game loop via Ticker
- GameObject lifecycle
- Physics simulation (Rapier)
- Asset loading per scene
- Event dispatching
- Process management

**Lifecycle**:
1. Constructor: Initialize state
2. `load()`: Load assets
3. `onLoad()`: Setup scene (called after assets load)
4. `onTransitionCompleted()`: Called after scene transition
5. Tick loop: `onBeforeTick` → `onTick` → `onAfterTick`
6. Fixed tick loop: `onBeforeFixedTick` → `onFixedTick` → `onAfterFixedTick`
7. `onBeforeUnload()`: Cleanup before unload
8. `destroy()`: Final cleanup

**Key Features**:
- Generic state management with TypeScript
- Event system using `TypedEventTarget`
- GameObject query methods (by name, tag, class)
- Pause/unpause functionality
- Auto-start option

### 3. GameObject System

**Location**: `src/GameObject/index.ts`

GameObjects are entities in the scene that:
- Contain multiple Components
- Have lifecycle hooks
- Can be queried by name, tag, or class
- Support process modes (pausable, always, whenPaused)
- Can be destroyed or queued for destruction

**Process Modes**:
- `pausable`: Only process when scene is not paused (default)
- `always`: Always process regardless of pause state
- `whenPaused`: Only process when scene is paused

**Component Management**:
- `addComponent()`: Add and instantiate a component
- `registerComponents()`: Register existing components
- `getComponentByClass()`, `getComponentByName()`, `getComponentByTag()`: Query components
- `unregisterComponent()`: Remove components

### 4. Component System

**Location**: `src/components/BaseComponent/index.ts`

Components are modular pieces of functionality:
- Attached to a parent GameObject
- Have lifecycle hooks matching GameObject/Scene
- Can be enabled/disabled
- Support tags for querying

**Lifecycle Hooks**:
- `onAdded()`: Called when component is added to GameObject
- `onBeforeTick(dt)`: Before each frame
- `onTick(dt)`: Each frame
- `onBeforeFixedTick(dt)`: Before each physics step
- `onFixedTick(dt)`: Each physics step (fixed timestep)
- `onAfterFixedTick(dt)`: After each physics step
- `onAfterTick(dt)`: After each frame
- `onRemoved()`: Called when component is removed
- `destroy()`: Cleanup

### 5. Process System

**Location**: `src/Process/index.ts`

The Process system provides coroutine-like functionality for:
- Timers and intervals
- Tweening and animations
- Async game logic
- Time-based operations

**Process Types**:
- `spawn()`: Generic process with callbacks
- `spawnTimer()`: One-shot timer
- `spawnInterval()`: Repeating interval
- `tween()`: Tween between values
- `tweenProperty()`: Tween object properties

**Process Features**:
- Duration-based execution
- Loop support
- Pause/resume
- Progress tracking
- Context management
- Promise-based await

**Example**:
```typescript
Process.spawn({
  duration: 1000,
  onTick: ({ progress, totalElapsed }) => {
    sprite.alpha = progress
  },
  onComplete: () => {
    console.log('Animation complete!')
  }
})
```

### 6. Executor/Context System

**Location**: `src/Executor/index.ts`

The Executor manages global execution context:
- Stores current game and scene references
- Allows components/processes to access current context
- Used by utility functions to get current scene

**Usage**:
```typescript
Executor.setContext({ game, scene })
const { game, scene } = Executor.ctx
```

### 7. Physics System

**Location**: `src/Scene/Rapier.ts`

Integrates Rapier2D physics:
- Fixed timestep simulation
- Pixel-to-meter ratio conversion
- World gravity configuration
- Collision detection

**RapierBodyComponent**:
Attaches rigid bodies and colliders to GameObjects.

### 8. Rendering System

**Location**: `src/Scene/Display.ts`

Built on PixiJS:
- Hardware-accelerated 2D rendering
- Sprite rendering
- Graphics primitives
- Particle systems
- Tilemaps
- UI elements

**Key Components**:
- `GraphicComponent`: Render PixiJS graphics
- `AnimatedGraphicComponent`: Animated sprites
- `AnimationControllerComponent`: Animation state machine
- `ParticlesEmitterComponent`: Particle effects
- `TilemapComponent`: Tilemap rendering

## Component Library

### Graphics Components

1. **GraphicComponent** (`src/components/GraphicComponent/index.ts`)
   - Renders PixiJS display objects
   - Supports linked transforms (for physics bodies)
   - Z-index ordering

2. **AnimatedGraphicComponent** (`src/components/AnimatedGraphicComponent/index.ts`)
   - Sprite animation playback
   - Animation sequences
   - Frame-based animations

3. **AnimationControllerComponent** (`src/components/AnimationControllerComponent/index.ts`)
   - Keyframe-based animation system
   - Multiple easing functions and interpolation
   - Loop support and event callbacks

### Physics Components

1. **RapierBodyComponent** (`src/components/RapierBodyComponent/index.ts`)
   - Rigid body physics
   - Collider management
   - Transform synchronization
   - Physics queries

### Audio Components

1. **AudioComponent** (`src/components/AudioComponent/index.ts`)
   - Sound playback
   - Volume control
   - Looping support

### Particle Components

1. **ParticlesEmitterComponent** (`src/components/ParticlesEmitterComponent/index.ts`)
   - Particle emission
   - Particle configuration
   - Effects system

### Input Components

1. **InputComponent** (`src/components/InputComponent/index.ts`)
   - Keyboard input handling
   - Input mapping
   - Action-based input

### Script Components

1. **ScriptComponent** (`src/components/ScriptComponent/index.ts`)
   - Custom script logic
   - Lifecycle integration

### State Machine Components

1. **FSMComponent** (`src/components/FSMComponent/index.ts`)
   - Finite state machine integration
   - XState integration
   - State-based behavior

### Tilemap Components

1. **TilemapComponent** (`src/components/TilemapComponent/index.ts`)
   - Tilemap rendering
   - Tiled map format support
   - Layer management

### UI Components

Located in `src/components/UI/`:
- **UITextComponent**: Text rendering
- **UIButtonComponent**: Interactive buttons
- **UIBitmapTextComponent**: Bitmap font text

## Utility Systems

**Location**: `src/utils/`

### Key Utilities:

- **context.ts**: Get current scene/game
- **interpolation.ts**: Easing and interpolation functions
- **physics.ts**: Physics helper functions
- **vectors.ts**: Vector math utilities
- **matrix.ts**: Matrix operations
- **noise.ts**: Noise generation
- **random.ts**: Random number utilities
- **time.ts**: Time utilities (delays, promises)
- **space.ts**: Coordinate system conversions (pu - pixel units)
- **tilemaps/**: Tilemap utilities and parsing
- **tileset-loader.ts**: Tileset asset loading
- **midi-loader.ts**: MIDI file loading (internal, used by Scene)
- **terrain.ts**: Terrain generation
- **object-pool.ts**: Object pooling

## Data Flow

### Game Loop Flow

```
1. Ticker emits frame
   ↓
2. Scene.onBeforeTick(dt)
   ↓
3. Scene.onTick(dt)
   ├─→ Physics step simulation
   │   ├─→ Scene.onBeforeFixedTick(timestep)
   │   │   └─→ GameObject.onBeforeFixedTick(timestep)
   │   │       └─→ Component.onBeforeFixedTick(timestep)
   │   ├─→ Scene.onFixedTick(timestep)
   │   │   ├─→ Process.onTick(timestep)
   │   │   └─→ GameObject.onFixedTick(timestep)
   │   │       └─→ Component.onFixedTick(timestep)
   │   └─→ Scene.onAfterFixedTick(timestep)
   │       └─→ GameObject.onAfterFixedTick(timestep)
   │           ├─→ Component.onAfterFixedTick(timestep)
   │           └─→ Destroy queued GameObjects
   └─→ GameObject.onTick(dt)
       └─→ Component.onTick(dt)
   ↓
4. Scene.onAfterTick(dt) (async)
   └─→ GameObject.onAfterTick(dt)
       └─→ Component.onAfterTick(dt)
```

### Scene Transition Flow

```
1. game.transitionTo(newScene)
   ↓
2. Load new scene assets
   ↓
3. Add new scene to stage (alpha = 0)
   ↓
4. Run transition function
   ├─→ Fade out old scene
   └─→ Fade in new scene
   ↓
5. Remove old scene from stage
   ↓
6. Cleanup old scene
   └─→ oldScene.onBeforeUnload()
       └─→ oldScene.destroy()
   ↓
7. Set new scene as current
   ↓
8. newScene.onTransitionCompleted()
```

## Design Patterns

### 1. Component Pattern
GameObjects use composition over inheritance by adding Components.

### 2. Observer Pattern
Scenes use event dispatching with TypedEventTarget for type-safe events.

### 3. Object Pool Pattern
Available via `utils/object-pool.ts` for performance optimization.

### 4. State Pattern
FSMComponent uses XState for finite state machines.

### 5. Factory Pattern
`instantiateGameObject()` and `addComponent()` methods act as factories.

## Performance Considerations

1. **Fixed Timestep**: Physics runs at a fixed timestep for determinism
2. **Object Pooling**: Use object pools for frequently created/destroyed objects
3. **Component Queries**: Results are not cached, avoid querying in hot loops
4. **Process Management**: Processes are tracked per scene and cleaned up automatically
5. **Asset Loading**: Assets are loaded per scene and managed by PixiJS cache
6. **Pause Mode**: Use process modes to control what runs when paused

## Extension Points

### Creating Custom Components

```typescript
import { Component } from 'yage'

export class MyComponent extends Component {
  constructor(parent: GameObject, options: MyOptions) {
    super(parent)
    // Initialize component
  }

  onAdded() {
    // Called when added to GameObject
  }

  onTick(dt: number) {
    // Update logic each frame
  }

  onRemoved() {
    // Called when removed from GameObject
  }

  destroy() {
    // Cleanup
    super.destroy()
  }
}
```

### Creating Custom GameObjects

```typescript
import { GameObject, GraphicComponent } from 'yage'

export class MyGameObject extends GameObject {
  constructor(scene: Scene) {
    super(scene)

    // Add components
    this.addComponent(GraphicComponent, { ... })

    // Set properties
    this.name = 'my-object'
    this.tags = ['player']
  }

  onAdded() {
    // Called when added to scene
  }
}
```

### Creating Custom Scenes

```typescript
import { Scene } from 'yage'

export class MyScene extends Scene<MyState, MyEvents> {
  assetsBundle = {
    'sprite': 'path/to/sprite.png',
  }

  onLoad() {
    super.onLoad()
    // Setup scene after assets load
    this.instantiateGameObject(MyGameObject)
  }

  onTick(dt: number) {
    super.onTick(dt)
    // Custom scene logic
  }
}
```

## Testing

Tests are located alongside source files and use Vitest.

Run tests:
```bash
npm test
```

## Build System

YAGE uses TypeScript with multiple build targets:

- **ESM**: ES Modules for modern bundlers
- **CJS**: CommonJS for Node.js compatibility
- **Types**: TypeScript declaration files

Build configuration:
- `tsconfig.esm.json`: ESM build
- `tsconfig.cjs.json`: CJS build
- `tsconfig.types.json`: Type declarations

## Dependencies

### Runtime Dependencies
- `pixi.js`: Rendering engine
- `@dimforge/rapier2d`: Physics engine
- `xstate`: State machines
- `@pixi/sound`: Audio
- `@pixi/particle-emitter`: Particles
- `@pixi/tilemap`: Tilemap rendering
- `@pixi/ui`: UI components
- `pixi-viewport`: Camera/viewport
- `pixi-filters`: Visual effects
- `lodash`: Utilities

### Development Dependencies
- `typescript`: Type checking and compilation
- `vite`: Development server and bundler
- `vitest`: Testing framework
- `eslint`: Linting
- `prettier`: Code formatting

## Common Patterns

### Loading Assets
```typescript
class MyScene extends Scene {
  assetsBundle = {
    'player': 'assets/player.png',
    'sound': 'assets/music.mp3',
  }

  async load() {
    await super.load()
    // Assets are now loaded
  }
}
```

### Creating a GameObject with Physics
```typescript
import { GameObject, RapierBodyComponent, GraphicComponent } from 'yage'
import { RigidBodyDesc, ColliderDesc } from '@dimforge/rapier2d'

class PhysicsObject extends GameObject {
  constructor(scene: Scene) {
    super(scene)

    const rigidBody = RigidBodyDesc.dynamic()
    const collider = ColliderDesc.ball(1)
    const physics = this.addComponent(RapierBodyComponent, rigidBody, collider)

    this.addComponent(GraphicComponent, {
      graphic: createGraphic(),
      linkedTransform: physics.transform
    })
  }
}
```

### Using Processes for Animation
```typescript
import { Process } from 'yage'

// Tween position
Process.tweenProperty(sprite, 'x', 100, 1000)

// Custom animation
Process.spawn({
  duration: 1000,
  setup: () => ({ startX: sprite.x }),
  onTick: ({ context, progress }) => {
    sprite.x = context.startX + 100 * progress
  },
  onComplete: () => {
    console.log('Done!')
  }
})
```

### Querying GameObjects/Components
```typescript
// In a Scene
const player = this.getGameObjectByTag('player')
const enemies = this.getGameObjectsByClass(EnemyObject)

// In a GameObject
const physics = this.getComponentByClass(RapierBodyComponent)
const graphics = this.getComponentsByTag('renderable')
```
