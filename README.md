# YAGE - Yet Another Game Engine

A component-based 2D game engine built with TypeScript, PixiJS, and Rapier physics.

## Overview

YAGE is a lightweight, modular game engine designed for creating 2D games in the browser. It follows an Entity-Component-System (ECS) inspired architecture and provides a comprehensive set of features for game development.

## Key Features

- **Component-Based Architecture**: Modular design using GameObjects and Components
- **Physics Integration**: Built-in Rapier2D physics engine support
- **Scene Management**: Flexible scene system with transitions and lifecycle management
- **Process System**: Coroutine-like process system for animations and async logic
- **Rich Component Library**: Pre-built components for graphics, audio, particles, input, and more
- **TypeScript**: Fully typed for better developer experience
- **PixiJS Rendering**: Hardware-accelerated 2D rendering via WebGL
- **Asset Management**: Integrated asset loading and management

## Tech Stack

- **Rendering**: PixiJS v7
- **Physics**: Rapier2D v0.11
- **State Management**: XState v4
- **Build Tool**: Vite
- **Testing**: Vitest
- **Language**: TypeScript v5

## Installation

```bash
npm install
```

## Development

```bash
# Run development server
npm run dev

# Build the library
npm run build

# Watch mode for development
npm run build:watch

# Run tests
npm test

# Generate documentation
npm run docs

# Lint code
npm run lint
```

## Project Structure

```
yage/
├── src/
│   ├── Game/              # Game instance and initialization
│   ├── Scene/             # Scene management and lifecycle
│   ├── GameObject/        # GameObject base class
│   ├── components/        # Component library
│   │   ├── BaseComponent/
│   │   ├── GraphicComponent/
│   │   ├── AnimatedGraphicComponent/
│   │   ├── AnimationControllerComponent/
│   │   ├── RapierBodyComponent/
│   │   ├── ParticlesEmitterComponent/
│   │   ├── AudioComponent/
│   │   ├── InputComponent/
│   │   ├── ScriptComponent/
│   │   ├── FSMComponent/
│   │   ├── TilemapComponent/
│   │   └── UI/            # UI components
│   ├── Process/           # Process/coroutine system
│   ├── Executor/          # Execution context management
│   ├── premade/           # Premade GameObjects and Scenes
│   │   ├── gameobjects/   # Premade GameObjects (DialoguePlayer, etc.)
│   │   └── scenes/        # Premade Scenes (LoadingScene)
│   ├── utils/             # Utility functions
│   │   ├── interpolation.ts
│   │   ├── physics.ts
│   │   ├── vectors.ts
│   │   ├── matrix.ts
│   │   ├── noise.ts
│   │   ├── random.ts
│   │   ├── terrain.ts
│   │   ├── tilemaps/
│   │   └── ...
│   └── index.ts           # Main export
├── examples/              # Example projects
│   ├── bounce/
│   ├── animation/
│   ├── animated-sprite/
│   ├── dialogue/
│   ├── input/
│   ├── loader/
│   └── particles/
└── dist/                  # Build output
```

## Quick Start

### Creating a Simple Game

```typescript
import { Game, Scene, GameObject, GraphicComponent, Executor } from 'yage'
import { Graphics } from 'pixi.js'

// Define a custom GameObject
class Player extends GameObject {
  constructor(scene: Scene) {
    super(scene)

    const graphic = new Graphics()
    graphic.beginFill(0xFF0000)
    graphic.drawCircle(0, 0, 20)
    graphic.endFill()

    this.addComponent(GraphicComponent, { graphic })
  }
}

// Define a Scene
class GameScene extends Scene {
  onLoad() {
    super.onLoad()
    this.instantiateGameObject(Player)
  }
}

// Initialize and run the game
const game = new Game({
  width: 800,
  height: 600,
})

const scene = new GameScene()
await Executor.execute(game)
game.loadScene(scene)
```

## Core Concepts

### Game
The main game instance that manages the PixiJS application, canvas, and screen resizing.

### Scene
A container for game logic, managing GameObjects, physics simulation, and the game loop.

### GameObject
An entity in the game that can have multiple Components attached to it.

### Component
Modular pieces of functionality that can be attached to GameObjects (rendering, physics, input, etc.).

### Process
A coroutine-like system for managing time-based operations, animations, and tweens.

### Executor
Manages execution context for accessing the current game and scene from anywhere.

## Examples

Check the `/examples` directory for complete working examples:

- **bounce**: Physics simulation with bouncing balls
- **animation**: Sprite animation system
- **animated-sprite**: Animated graphics with physics
- **dialogue**: Dialogue system implementation
- **input**: Input handling examples
- **loader**: Asset loading with loading screen
- **particles**: Particle effects system

## Building for Production

```bash
npm run build
```

This generates:
- CommonJS build in `dist/`
- ESM build in `dist/`
- Type definitions in `dist/`

## License

See LICENSE file for details.

## Contributing

See CONTRIBUTING.md for development guidelines.
