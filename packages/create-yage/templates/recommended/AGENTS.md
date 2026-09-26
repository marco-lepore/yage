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
├── vite.config.ts                 # Vite, WebAssembly, and installable-app setup
├── public/
│   ├── icon.svg                   # browser tab icon
│   ├── pwa-192x192.png            # installed-app icons
│   ├── pwa-512x512.png
│   ├── apple-touch-icon.png       # iOS home-screen icon (180×180)
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
- `@yagejs/debug` — debug overlay and runtime inspector (`DebugPlugin` in `main.ts`)

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

## Installable app and offline play

The production build is a Progressive Web App: players can install it, and it
runs offline after the first visit. `vite-plugin-pwa` in `vite.config.ts`
sets this up.

- **Assets need no registration.** Every build caches every file in `dist/`
  for offline play, including everything in `public/` and the physics
  `.wasm`. Adding a file to `public/assets/` is enough.
- **Files over 10 MB fail the build.** The error names each file. Raise
  `maximumFileSizeToCacheInBytes` in `vite.config.ts` to allow them.
- **Assets from another server are not cached.** Add a `runtimeCaching` rule
  to the `workbox` block for them.
- **No service worker in `npm run dev`.** Check installed and offline
  behaviour with `npm run build` followed by `npm run preview`.
- **To test an update:** open the game from `npm run preview` and reload it
  once so the service worker controls the page. Rebuild with a change, then
  click Update under Application → Service workers in Chrome's developer
  tools. The new version waits until every tab of the game is closed, or
  until your code applies it.
- **Updates start on the next launch.** A deploy downloads in the background.
  The running game keeps its version, even across reloads, until every tab or
  window of it is closed. Host or CDN caching must not keep a stale `sw.js`
  or `index.html`.
- **To prompt players to update in-game**, follow
  https://yage.dev/getting-started/installation/#offer-an-update-in-game. The
  template does not include that code.
- **Before shipping:** change `name`, `short_name`, and `description` in the
  `manifest` block, and replace `public/icon.svg`, `public/pwa-192x192.png`,
  `public/pwa-512x512.png`, and `public/apple-touch-icon.png`. Android crops
  the 512 icon to a circle or rounded square, so keep artwork inside the
  centre 80%. Serve the site over HTTPS.

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

`main.ts` starts the engine with `debug: true`, which publishes
`window.__yage__`, and installs `DebugPlugin`, which puts the inspector on it.
In the browser console:

```js
window.__yage__.inspector.snapshot();
window.__yage__.inspector.getEntities();
window.__yage__.inspector.getEntity("player"); // name, or an entity id
window.__yage__.inspector.getComponentData("player", "RigidBodyComponent");
```
