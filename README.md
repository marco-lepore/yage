<p align="center">
  <img src="assets/logo-horizontal.svg" alt="yage" width="360">
</p>

<p align="center">
  <strong>Yet Another Game Engine</strong><br>
  A 2D game engine for TypeScript, built on PixiJS and Rapier2D.
</p>

---

## What is yage?

yage is a personal, opinionated 2D game engine that composes [PixiJS](https://pixijs.com/) (rendering) and [Rapier](https://rapier.rs/) (physics) with an ECS-inspired architecture, scene management, serialization, and debug tooling.

It's designed with AI-assisted development in mind — featuring deterministic tests, an inspector, and structured feedback loops that make it easy to build games with LLMs.

## Quick Start

The fastest way to start a new game:

```bash
npm create yage@latest my-game
cd my-game
npm run dev
```

This scaffolds a playable platformer with physics, input, animations, and
sound effects — a solid starting point to build on. Choose the `minimal`
template if you'd rather start from an empty scene.

### Manual setup

Install packages individually if you prefer to wire things up yourself:

```bash
npm install @yagejs/core @yagejs/renderer
```

Add more as you need them:

```bash
npm install @yagejs/physics @yagejs/input @yagejs/audio @yagejs/debug
```

See the [installation guide](https://yage.dev/getting-started/installation)
for Vite configuration and bundler setup.

## Packages

| Package           | Description                                      |
| ----------------- | ------------------------------------------------ |
| `@yagejs/core`      | ECS, scenes, game loop, animation, serialization |
| `@yagejs/renderer`  | PixiJS rendering integration                     |
| `@yagejs/physics`   | Rapier2D physics integration                     |
| `@yagejs/input`     | Keyboard and pointer input                       |
| `@yagejs/audio`     | Audio playback                                   |
| `@yagejs/particles` | Particle effects                                 |
| `@yagejs/tilemap`   | Tilemap support                                  |
| `@yagejs/ui`        | UI components                                    |
| `@yagejs/ui-react`  | React-based UI                                   |
| `@yagejs/save`      | Save/load system                                 |
| `@yagejs/debug`     | Debug overlay and inspector                      |

## Development

```bash
npm install
npx turbo run build
npx turbo run dev --filter=examples
```

## Links

- [Documentation](https://yage.dev)
- [Examples](https://examples.yage.dev)

## License

MIT
