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

## Packages

| Package           | Description                                      |
| ----------------- | ------------------------------------------------ |
| `@yage/core`      | ECS, scenes, game loop, animation, serialization |
| `@yage/renderer`  | PixiJS rendering integration                     |
| `@yage/physics`   | Rapier2D physics integration                     |
| `@yage/input`     | Keyboard and pointer input                       |
| `@yage/audio`     | Audio playback                                   |
| `@yage/particles` | Particle effects                                 |
| `@yage/tilemap`   | Tilemap support                                  |
| `@yage/ui`        | UI components                                    |
| `@yage/ui-react`  | React-based UI                                   |
| `@yage/save`      | Save/load system                                 |
| `@yage/debug`     | Debug overlay and inspector                      |

## Getting Started

```bash
npm install yage
```

> Packages are not published to npm yet. For now, clone the repo and build locally.

See the [documentation](https://yage.dev) for guides, API reference, and examples.

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
