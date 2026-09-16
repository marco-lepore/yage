# Agent Guide

This is a [YAGE](https://yage.dev) 2D game engine project (TypeScript + Vite).

## Run locally

- `npm install`
- `npm run dev` — start Vite dev server on http://localhost:5173
- `npm run build` — production build to `dist/`
- `npm run preview` — preview the production build

## What's in the starter

The starter is a playable platformer. Move with `A`/`D` or the arrow keys,
and jump with `Space`. Collect yellow coins. Avoid the red spiky hazards and
the purple slimes. Touching a hazard or a slime respawns the player at the
start. The level is defined in `src/scenes/GameScene.ts`. Change the entity
positions there, or spawn more entities.

## Project layout

```
├── public/
│   └── assets/                    # sprites, sounds, and their credits
│       ├── CREDITS.md
│       ├── coin.png
│       ├── hurt.wav
│       ├── jump.wav
│       ├── player-idle.png
│       ├── player-jump.png
│       ├── player-walk.png
│       └── slime_purple.png
└── src/
    ├── main.ts                    # boot: Engine, plugins, initial scene
    ├── layers.ts                  # physics collision layers
    ├── traits.ts                  # shared entity traits
    ├── scenes/
    │   └── GameScene.ts           # camera, preload, spawns, event listeners
    ├── entities/
    │   ├── Player/                # entity plus its controller component
    │   │   ├── index.ts
    │   │   └── PlayerController.ts
    │   ├── Coin.ts
    │   ├── Hazard.ts
    │   ├── Platform.ts
    │   ├── Slime.ts
    │   └── Wall.ts
    └── components/
        └── Oscillate.ts           # shared by Coin and Hazard
```

See https://yage.dev/patterns/project-layout for the full conventions.
**Short version:**

- **One scene per file.** A scene preloads assets, sets up the camera, and spawns entities. If a scene grows past ~150 lines, extract entity classes.
- **Simple entity → single file; complex entity → folder.** Move an entity into a folder only when it has a second supporting file.
- **Entity-specific components live next to the entity**, such as `Player/PlayerController.ts`. Use `components/` only for components shared across multiple entities, such as `Oscillate`.
- **`main.ts` stays short.** It creates the engine, registers plugins, and pushes the first scene. Keep game logic out of it.

## Installed packages

- `@yagejs/core` — ECS, math, events, scenes, the game loop
- `@yagejs/renderer` — PixiJS-based rendering, sprites, camera
- `@yagejs/physics` — Rapier2D physics with pixel↔meter conversion
- `@yagejs/input` — keyboard, mouse, gamepad, action maps
- `@yagejs/audio` — sound effects and music
- `@yagejs/debug` — debug overlay and runtime inspector (enabled via `debug: true` in `main.ts`)

Add more as you need them: `@yagejs/particles`, `@yagejs/tilemap`, `@yagejs/ui`, `@yagejs/ui-react`, `@yagejs/save`.

## Key conventions

- `Vec2` is immutable — operations return new instances
- `Transform` is mutable — call `.setPosition(...)`, `.rotate(...)` in place
- Pixels are the primary unit across every public API
- Put game logic in components. Systems are for engine internals only
- Use `setVelocity` on `RigidBodyComponent`, not `applyImpulse` — impulses need careful unit math
- Spawn entities with `scene.spawn(EntityClass, params)` — YAGE calls `setup(params)` automatically
- Resolve services with `this.service(Key)` or `this.use(Key)` inside components
- Declare asset handles with `texture()` / `sound()` at module scope and list them in `Scene.preload`. Every listed handle is loaded before `onEnter` runs

## Assets

Files in `public/` are served at the site root by Vite. A handle declared
as `texture("/assets/player-idle.png")` resolves to
`public/assets/player-idle.png`. The starter includes:

- `public/assets/player-idle.png`, `public/assets/player-walk.png`, and
  `public/assets/player-jump.png` by Zegley
- `public/assets/coin.png`, `public/assets/slime_purple.png`,
  `public/assets/jump.wav`, and `public/assets/hurt.wav` from the Brackeys
  Platformer Bundle

See `public/assets/CREDITS.md` for source links and license details.

Replace them with your own assets, and keep the file paths matching the
handles your scene's `preload` declares.

## Save state

Use `@yagejs/save` with an explicit `Serializable<TEncoded>` state root. Save
files contain only the state you choose. YAGE does not serialize the live ECS
world automatically. The Vite config preserves class and function names so
diagnostics stay readable. Do not rely on those names for save-file identity.

## Full YAGE documentation

- Short index: https://yage.dev/llms.txt
- Full reference (for long LLM contexts): https://yage.dev/llms-full.txt
- Getting started tutorial: https://yage.dev/getting-started/your-first-game
- Project layout conventions: https://yage.dev/patterns/project-layout
- GitHub: https://github.com/marco-lepore/yage

## Runtime inspector

`main.ts` starts the engine with `debug: true`, which adds
`window.__yage__.inspector` in the browser console:

```js
window.__yage__.inspector.snapshot();
window.__yage__.inspector.getEntities();
window.__yage__.inspector.getEntity("player"); // name, or an entity id
window.__yage__.inspector.getComponentData("player", "RigidBodyComponent");
```
