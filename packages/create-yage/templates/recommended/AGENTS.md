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

## If you add `@yagejs/save` later

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

## Agent-driven debugging — throwaway Inspector specs

For LLM-assisted gameplay validation, combine the Inspector with frozen
time and scripted input in a **throwaway Playwright spec** — write it,
run it, delete it. Not a CI fixture.

When you need to validate a gameplay change ("can the player still reach
the ledge after my jump-arc tweak?"), or troubleshoot a reported bug
("does the door open after 30 frames of holding the lever?"), reach for
this. Skip it when the question doesn't have a frame-level answer.

Add Playwright once:

```bash
npm install -D @playwright/test
npx playwright install chromium
```

Then drop a one-off spec like:

```ts
import { test, expect } from "@playwright/test";

test("can the player jump onto the ledge?", async ({ page }) => {
  await page.goto("http://localhost:5173/");
  await page.waitForFunction(() => window.__yage__?.inspector);

  const result = await page.evaluate(async () => {
    const i = window.__yage__.inspector;
    i.setSeed(42);
    i.time.freeze();
    await i.input.hold("ArrowRight", 30);
    await i.input.fireAction("jump", 1);
    i.time.step(45);
    return i.snapshotJSON();
  });

  expect(result).toContain('"name":"player"');
});
```

Run with `npx playwright test`. **Don't commit it** — frame counts are
brittle against balance constants, and these specs exist for one
debugging session. Delete after.

Discipline: prefer `inspector.time.step(N)` (loops one fixed-timestep
frame at a time) over `clock.step(bigDt)` — the latter collapses the
whole interval into a single fat frame and `Component.update`, tweens,
and AI logic only see one update at the full `bigDt`.

Honest limits: snapshots cover structural state, not pixel output;
`page.screenshot()` helps but agent-grade pixel interpretation is
imperfect — combine both. Audio doesn't pause in step mode (no
introspection surface). `setTimeout` / `Date.now()` bypass the frame
clock.

Full discipline: https://yage.dev/guides/debug
