# Agent Guide

This is a [YAGE](https://yage.dev) 2D game engine project (TypeScript + Vite).

## Run locally

- `npm install`
- `npm run dev` — start Vite dev server on http://localhost:5173
- `npm run build` — production build to `dist/`
- `npm run preview` — preview the production build

## What's in the starter

A playable platformer seed: move with `A`/`D` (or arrow keys), jump with
`Space`. Collect yellow coins. Avoid the red spiky hazards — touching one
respawns the player at the start. The platforms, coins, and hazards are
defined in `src/scenes/GameScene.ts`; tweak their positions or spawn more.

## Project layout

```
src/
├── main.ts                        # boot: Engine, plugins, push initial scene
├── scenes/
│   └── GameScene.ts               # camera + preload + spawns + event listeners
├── entities/
│   ├── Player/                    # complex entity — folder with supporting files
│   │   ├── index.ts               #   the Entity subclass
│   │   └── PlayerController.ts    #   entity-specific component
│   ├── Platform.ts                # simple entity — single file
│   ├── Coin.ts                    # simple entity — uses shared Oscillate
│   ├── Hazard.ts                  # simple entity — uses shared Oscillate
│   └── Wall.ts                    # simple entity — no graphics (invisible)
├── components/
│   └── Oscillate.ts               # shared: used by both Coin and Hazard
└── public/assets/                 # static files (Vite serves from / at runtime)
    ├── player.png
    └── jump.wav
```

See https://yage.dev/patterns/project-layout for the full convention writeup.
**Short version:**

- **One scene per file.** Scenes should be orchestrators — preload, camera, spawn entities. If a scene grows past ~150 lines, extract entity classes.
- **Simple entity → single file; complex entity → folder.** Promote to a folder only when you have a second supporting file.
- **Entity-specific components live next to the entity** (e.g. `Player/PlayerController.ts`), not in `components/`. `components/` is reserved for components shared across multiple entities (e.g. `Oscillate`).
- **`main.ts` stays short.** Engine creation, plugin registration, scene push. No game logic.

## Installed packages

- `@yage/core` — ECS, math, events, scenes, the game loop
- `@yage/renderer` — PixiJS-based rendering, sprites, camera
- `@yage/physics` — Rapier2D physics with pixel↔meter conversion
- `@yage/input` — keyboard, mouse, gamepad, action maps
- `@yage/audio` — sound effects and music
- `@yage/debug` — debug overlay and runtime inspector (enabled via `debug: true` in `main.ts`)

Add more as you need them: `@yage/particles`, `@yage/tilemap`, `@yage/ui`, `@yage/ui-react`, `@yage/save`.

## Key conventions

- `Vec2` is immutable — operations return new instances
- `Transform` is mutable — call `.setPosition(...)`, `.rotate(...)` in place
- Pixels are the primary unit across every public API
- Components own game logic; systems are for engine internals only
- Use `setVelocity` on `RigidBodyComponent`, not `applyImpulse` — impulses need careful unit math
- Spawn entities with `scene.spawn(EntityClass, params)` — YAGE calls `setup(params)` automatically
- Resolve services with `this.service(Key)` or `this.use(Key)` inside components
- Declare asset handles with `texture()` / `sound()` at module scope and list them in `Scene.preload` — everything is guaranteed loaded before `onEnter` runs

## Assets

Files in `public/` are served at the site root by Vite. A handle declared
as `texture("/assets/player.png")` resolves to `public/assets/player.png`.
The starter ships one sprite (`player.png`, a 10-frame idle strip) and one
sound effect (`jump.wav`), both Kenney.nl CC0. See `public/assets/CREDITS.md`.

Replace them with your own assets — just keep the paths in sync with
whatever your scene preload declares.

## If you add `@yage/save` later

The Vite config already has `oxc.decorator.legacy: true` so `@serializable`
decorators on your own classes will work immediately. You'll also want to
add `build.rollupOptions.output.keepNames: true` at that point so the save
system can match classes by name after minification.

## Full YAGE documentation

- Short index: https://yage.dev/llms.txt
- Full reference (for long LLM contexts): https://yage.dev/llms-full.txt
- Getting started tutorial: https://yage.dev/getting-started/your-first-game
- Project layout conventions: https://yage.dev/patterns/project-layout
- GitHub: https://github.com/marco-lepore/yage

## Runtime inspector

The engine is started with `debug: true`, which exposes `window.__yage__.inspector`
in the browser console:

```js
window.__yage__.inspector.snapshot();
window.__yage__.inspector.getEntities();
window.__yage__.inspector.getEntityByName("player");
window.__yage__.inspector.getComponentData("player", "RigidBodyComponent");
```
