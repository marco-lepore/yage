# Agent Guide

This is a [YAGE](https://yage.dev) 2D game engine project (TypeScript + Vite).

## Run locally

- `npm install`
- `npm run dev` — start Vite dev server on http://localhost:5173
- `npm run build` — production build to `dist/`
- `npm run preview` — preview the production build

## What's in the starter

The starter is a playable platformer. Move with `A`/`D` or the arrow keys,
and jump with `Space`. Collect yellow coins; the counter in the top-left
corner counts them. Avoid the red spiky hazards and the purple slimes.
Touching a hazard or a slime respawns the player at the start, and sends each
slime back to where it started. The level is defined in
`src/scenes/GameScene.ts`. Change the entity positions there, or spawn more
entities.

The Fullscreen button in the top-right corner is set up in
`src/fullscreen.ts`. It is hidden where the browser cannot show the page
fullscreen, such as on iPhone, and in the installed app on Android, which
already opens fullscreen. See
https://yage.dev/guides/rendering/responsive/#mobile-readiness for what the
page does on phones.

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
    ├── assets.ts                  # texture and sound handles, frame sizes
    ├── events.ts                  # game events (PlayerHit, CoinCollected)
    ├── fullscreen.ts              # the Fullscreen button in index.html
    ├── layers.ts                  # physics collision layers
    ├── traits.ts                  # shared entity traits
    ├── scenes/
    │   └── GameScene.ts           # assembles the level: preload, camera, spawns
    ├── entities/
    │   ├── Player/                # entity plus its components
    │   │   ├── index.ts
    │   │   ├── PlayerController.ts # input, movement, animation
    │   │   └── PlayerRespawn.ts   # back to the start when hit
    │   ├── Coin.ts
    │   ├── Hazard.ts
    │   ├── Hud.ts                 # coin counter; hosts the run's coin count
    │   ├── Platform.ts
    │   ├── Slime.ts
    │   └── Wall.ts
    └── components/
        └── Oscillate.ts           # shared by Coin and Hazard
```

See https://yage.dev/patterns/project-layout for the full conventions.
**Short version:**

- **One scene per file.** A scene preloads assets, sets up the camera, and spawns entities. Game rules stay out of it. If a scene grows past ~150 lines, extract entity classes.
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

## Writing game code

Follow these rules for every entity, component, and scene you add.

- **An entity type is an `Entity` subclass.** Its `setup(params)` adds the
  entity's components. Spawn it with `this.spawn(Coin, { x, y })`, and YAGE
  calls `setup(params)`. A function that builds and returns an entity should be
  a subclass instead. Spawn by name (`this.spawn("background")`) only for a
  one-off entity with no behaviour of its own, such as the background grid or
  a UI root.
- **Components hold the game logic.** Rules go in a component's `update(dt)`
  or `fixedUpdate(dt)`, its event handlers, and its methods. Systems are for
  engine internals only.
- **A component listens for events itself.** Declare an event with
  `defineEvent` and emit it on the entity (`this.entity.emit(PlayerHit)`).
  Entity events bubble to the scene. Listen with
  `this.listen(entity, PlayerHit, fn)` for one entity, or
  `this.listenScene(PlayerHit, fn)` for the event from any entity in the
  scene. Both unsubscribe when the component is removed. Events are declared
  in `src/events.ts`. `PlayerRespawn` emits `PlayerHit`, and each slime's
  `SlimeAI` listens for it.
- **`onEnter` assembles the scene.** It spawns entities, sets up the camera,
  and starts music. It holds no game state and no rules.
- **Game state lives in a component on a host entity.** Put the score, lives,
  or a run timer in a component. Spawn its entity with a key, and reach it
  with `scene.findByKey`, a query, or the reference `spawn()` returns. The
  starter's coin count works this way: `CoinCounter` in `src/entities/Hud.ts`
  listens for `CoinCollected` and keeps the count, and the scene spawns its
  entity with a key:

  ```ts
  // In onEnter:
  this.spawn(Hud, { key: HUD_KEY });
  // In any component:
  const coins = this.scene.findByKey<Hud>(HUD_KEY)?.counter.coins;
  ```

  Do not keep game state in a module-level variable, a field on the `Scene`,
  or a `ServiceKey` service. A module-level store (`createStore`,
  `createRecord`) is only for state that `@yagejs/save` persists.

- **Time comes from the engine.** `dt` and every duration are in seconds. A
  cooldown or a time window is a slot on the entity's `ProcessComponent`:

  ```ts
  class Dash extends Component {
    private readonly processes = this.sibling(ProcessComponent);
    private cooldown!: ProcessSlot;

    onAdd(): void {
      this.cooldown = this.processes.slot({ duration: 0.8 });
    }

    tryDash(): void {
      if (this.cooldown.running) return;
      this.cooldown.restart();
      // ...move the entity
    }
  }
  ```

  A one-off delay is `this.processes.run(Process.delay(0.5, fn))`. Do not use
  `setTimeout` or `setInterval`: they keep running while the game is paused
  and ignore the time scale.

- **Randomness comes from the scene.** `this.use(RandomKey)` returns the
  scene's `RandomService`, with `float()`, `range(min, max)`,
  `int(min, max)`, `pick(array)`, and `shuffle(array)`. Do not use
  `Math.random`. `window.__yage__.inspector.setSeed(1)` seeds every scene's
  generator, so a test run is reproducible.
- Resolve engine services with `this.service(Key)` or `this.use(Key)` inside
  components, never through a module-level `engine` variable.

## Key conventions

- `Vec2` is immutable — operations return new instances
- `Transform` is mutable — call `.setPosition(...)`, `.rotate(...)` in place
- Pixels are the primary unit across every public API
- Use `setVelocity` on `RigidBodyComponent`, not `applyImpulse` — impulses need careful unit math
- Declare asset handles with `texture()` / `sound()` in `src/assets.ts` and list them in `Scene.preload`. Every listed handle is loaded before `onEnter` runs. Pass the handle itself where an API takes an asset (`audio.play(jumpSfx)`, `sheet: coinTex`), not its `.path`

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
handles in `src/assets.ts`.

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

`main.ts` starts the engine with `debug: true`, which adds
`window.__yage__.inspector` in the browser console:

```js
window.__yage__.inspector.snapshot();
window.__yage__.inspector.getEntities();
window.__yage__.inspector.getEntity("player"); // name, or an entity id
window.__yage__.inspector.getComponentData("player", "RigidBodyComponent");
```
