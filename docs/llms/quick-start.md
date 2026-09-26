# YAGE Quick Start

## Scaffolding a New Game (recommended)

```bash
npm create yage@latest my-game
cd my-game
npm run dev
```

Pick `recommended` for a playable platformer seed (physics, input, animations, enemies, collectibles) or `minimal` for an empty scene with just core + renderer.

Both templates' `index.html` is set up for phones: `viewport-fit=cover`, and a `#game` container sized `100dvh` (with a `100vh` fallback) and padded by `env(safe-area-inset-*)`. `recommended` also has a Fullscreen button (`src/fullscreen.ts`; hidden where neither `document.fullscreenEnabled` nor `webkitFullscreenEnabled` is `true`, such as iPhone, and in an installed app running `display-mode: fullscreen`) and `apple-mobile-web-app-status-bar-style: black-translucent`. Details: `packages/renderer.md` → Mobile readiness.

The `recommended` template's production build is an installable, offline-capable PWA (`vite-plugin-pwa` in `vite.config.ts`):

- Workbox precaches every file in `dist/` (`globPatterns: ["**/*"]`), including the Rapier `.wasm` and all of `public/`. Assets are never listed by hand; each build picks up new or changed files.
- A file over `maximumFileSizeToCacheInBytes` (10 MB) fails `vite build` with an error naming it; raise the limit. Cross-origin assets need a `runtimeCaching` rule.
- Releasing = `npm run build` + upload `dist/`. No version number: `dist/sw.js` embeds a content hash per file, and the browser byte-compares `sw.js` at each launch. On a difference it downloads changed files in the background; `registerType: "prompt"` with no update UI means the new version waits until every tab or window of the game is closed (a reload keeps the old version), so players see a release on their second launch. Host/CDN must not cache `sw.js` or `index.html` for long.
- No service worker in `npm run dev`: installing, offline play, and updates only exist in the production build (`npm run preview` serves it locally). Production needs HTTPS.
- In-game update prompt (not in the template; add on request) — `src/pwa.ts`, imported from `main.ts`. Importing `virtual:pwa-register` replaces the injected `registerSW.js`; `vite.config.ts` is unchanged:

  ```ts
  /// <reference types="vite-plugin-pwa/vanillajs" />
  import { registerSW } from "virtual:pwa-register";

  let updateReady = false;
  const updateSW = registerSW({
    onNeedRefresh() {
      updateReady = true; // new version downloaded and waiting
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // without this an open game only checks at launch
      setInterval(
        () => {
          registration.update().catch(() => {}); // rejects while offline; retried next hour
        },
        60 * 60 * 1000,
      );
    },
  });
  export const isUpdateReady = (): boolean => updateReady;
  export const applyUpdate = (): Promise<void> => updateSW(); // reloads the page
  ```

  `applyUpdate()` reloads, discarding in-memory state: call it from a title screen, pause menu, or after a save, e.g. `engine.events.on("scene:replaced", () => { if (isUpdateReady()) void applyUpdate(); })`. On a player's first visit the page is not yet controlled by the service worker, so `applyUpdate()` switches versions without reloading and the new version runs on the next launch.

- Before shipping, edit the `manifest` name, short name and description, and replace `public/icon.svg`, `public/pwa-192x192.png`, `public/pwa-512x512.png` (also the maskable icon: keep art in the centre 80%), and `public/apple-touch-icon.png` (180×180).

## Manual Installation

```bash
npm install @yagejs/core @yagejs/renderer
```

The packages must go through a bundler that supports TypeScript and ESM. Vite is recommended. Loading them in a browser without a bundler is not supported.

Add more packages as needed:

```bash
npm install @yagejs/physics @yagejs/input @yagejs/audio @yagejs/debug
```

Gameplay addons (dialogue, inventory, quests, and more) ship under the separate `@yagejs-addons/*` scope. Their docs are co-located at `packages/addons/<name>/docs/llms/`; the full list is in `llms.txt`.

## Versioning

The `@yagejs/*` packages are released as a set: one version across all of them, each requiring the others at that same minor. Upgrade them together, naming every `@yagejs/*` package in your `package.json` — the command below is an example, not the full set, and a package left out is a package not upgraded.

```bash
npm install @yagejs/core@latest @yagejs/renderer@latest @yagejs/input@latest
```

Upgrading one package to a new minor alone can install two copies of a shared package — e.g. a newer `@yagejs/save` beside an older `@yagejs/renderer` yields two `@yagejs/core` instances with separate service containers and class identities. npm reports some of these as a version conflict and nests others silently, so a completed install is not proof the versions match. Fix a reported conflict by upgrading the set, not with `--force` or `--legacy-peer-deps`.

`@yagejs-addons/*` packages version independently and each declares the engine minor it supports.

## Minimal Example

```ts
import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";

const engine = new Engine();
engine.use(
  new RendererPlugin({ width: 800, height: 600, backgroundColor: 0x1a1a2e }),
);
await engine.start();
```

## Engine Setup

```ts
import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { InputPlugin } from "@yagejs/input";
import { PhysicsPlugin } from "@yagejs/physics";

const engine = new Engine({ debug: true, fixedTimestep: 1 / 60 });
engine.use(
  new RendererPlugin({
    width: 800,
    height: 600,
    container: document.getElementById("game")!,
  }),
);
engine.use(
  new InputPlugin({
    actions: {
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      jump: ["Space", "KeyW"],
    },
  }),
);
engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 980 } }));

await engine.start();
engine.scenes.push(new GameScene());
```

## Scene, Entity, Component

Every scene is a `Scene` subclass. An entity type is an `Entity` subclass whose `setup(params)` adds its components. Game logic lives in components.

```ts
import { Component, Entity, Scene, Transform, Vec2 } from "@yagejs/core";
import { CameraEntity, SpriteComponent, texture } from "@yagejs/renderer";
import { InputManagerKey } from "@yagejs/input";

const HeroTex = texture("hero.png");

// Game logic lives in a component.
class PlayerController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);

  update(dt: number) {
    const dx = this.input.getAxis("left", "right"); // -1..1
    this.transform.translate(dx * 200 * dt, 0); // 200 px/s; dt is seconds
  }
}

// An entity type: an Entity subclass whose setup() takes the spawn params.
class Player extends Entity {
  setup({ x, y }: { x: number; y: number }) {
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(new SpriteComponent({ texture: HeroTex }));
    this.add(new PlayerController());
  }
}

class GameScene extends Scene {
  readonly name = "game";
  readonly preload = [HeroTex];

  // onEnter assembles the scene. State and rules live in components.
  onEnter() {
    const player = this.spawn(Player, { x: 100, y: 200 });
    this.spawn(CameraEntity, { follow: player });
  }
}

engine.scenes.push(new GameScene());
```

- `this.spawn(Class, params)` types `params` from `setup()`. The entity's debug name is its class name.
- `Entity` and `Scene` declare `update` / `fixedUpdate` as `never`; a subclass that defines either fails to compile. Per-frame logic is a component's `update(dt)` / `fixedUpdate(dt)`.
- A named spawn (`const bg = this.spawn("background"); bg.add(...)`) is only for a one-off entity: spawned once, with no behaviour of its own (background, UI root, HUD host). Anything spawned more than once, or with behaviour, is an `Entity` subclass.
- Game state (score, lives) lives in a component on a host entity; see `core-concepts.md` → Game State. Not a module-level `let`, a `Scene` field, or a `ServiceKey`.

## Testing & Debugging

### Inspector (runtime queries)

An engine constructed with `debug: true` installs an introspection API on `window.__yage__` during `engine.start()`. Useful in the browser console while iterating, and for AI agents that want to verify scene state without reading the canvas:

```ts
const engine = new Engine({ debug: true });
engine.use(new DebugPlugin()); // inspector.time (freeze/step) needs DebugPlugin
engine.use(new InputPlugin({ actions: {} })); // inspector.input needs InputPlugin
await engine.start();

// In the browser console:
window.__yage__.inspector.snapshot(); // full engine state
window.__yage__.inspector.getEntities(); // all entities in active scene
window.__yage__.inspector.getEntity("player"); // first active entity with this name
window.__yage__.inspector.getComponentData("player", "SpriteComponent");
const id = window.__yage__.inspector.getEntities()[0].id; // entity id
window.__yage__.inspector.getComponentData(id, "SpriteComponent"); // one specific entity
window.__yage__.inspector.getSceneStack(); // scenes + pause state
window.__yage__.inspector.getErrors(); // failures recorded by ErrorBoundary
window.__yage__.inspector.time.freeze(); // stop auto-advance
window.__yage__.inspector.time.step(1); // advance one frame (sync)
window.__yage__.inspector.input.keyDown("ArrowRight"); // synthetic input
window.__yage__.inspector.input.hold("ArrowRight", 30); // press, run N frames, release
window.__yage__.inspector.snapshotJSON(); // stable JSON snapshot
window.__yage__.inspector.setSeed(42); // pin every scene RNG (for replays)
window.__yage__.inspector.events.getLog(); // recorded bus, entity and scene events
window.__yage__.inspector.time.getFrame(); // real game-loop frame, automatic or manual
```

Snapshot and query calls work with `debug: true` alone. Frame stepping (`inspector.time.*`) needs `DebugPlugin`; synthetic input (`inspector.input.*`) needs `InputPlugin`. Without those plugins, the gated calls throw.

`time.step(N)` is synchronous and never gives async work (a scene transition, a dialogue runner) a chance to resolve. When a step needs to cross one, use the async variants instead — they yield a real macrotask between frames so pending microtasks can drain:

```ts
// Advance until a condition holds (throws after `maxFrames`, default 600):
await window.__yage__.inspector.time.stepUntil(() =>
  window.__yage__.inspector.getSceneStack().some((s) => s.name === "level2"),
);

// Advance a known frame count, still draining async work between frames:
await window.__yage__.inspector.time.stepAsync(45);
```

See `packages/debug.md` for `stepUntil`/`stepAsync` options, `snapshotScene(nameOrId)`, `events.setEnabled`/`isEnabled`, and `time.isAdvancing()`.

`events.waitFor` checks retained history without consuming matches. Clear the
log before an action when checking for a new occurrence. On a frozen clock,
advance frames while the wait is pending:

```ts
await window.__yage__.inspector.drive(async ({ events, input }) => {
  events.clearLog();
  await Promise.all([
    events.waitFor("player:jumped", { withinFrames: 30 }),
    input.hold("Space", 30),
  ]);
});
```

The example expects game code to emit `player:jumped`. Deadlines count real
frames, including automatic playback. A drive owns the clock until it ends;
use its context to step or inject frame-advancing input. Custom tools can
reserve the same control through `inspector.time.acquire()` and release the
returned lease when done. Raw time mutators reject while owned.

World-entity snapshots include `name`, optional `key`, `generation` and
`pooled`. Counts include inactive entities and exclude destroyed ones. Engine
snapshots report `fixedStepIndex` and `interpolationAlpha`; scene snapshots
report `elapsed`, `fixedElapsed` and `physics.elapsed` in seconds. Scene ids
identify runtime instances and change when a run creates new scenes.

Diagnostics that need optional plugins live under inspector extension
namespaces. For example, `DebugPlugin` registers `debug` while installed.
Pass the extension's interface as the type parameter so calls type-check:

```ts
import type { DebugDiagnostics } from "@yagejs/debug";

const debug = window.__yage__.inspector.getExtension<DebugDiagnostics>("debug");
debug?.getCameraStack();
debug?.getLayerTransform("game", "world");
```

`getEntities()` returns an array of `EntitySnapshot` objects with `id`, `name`, `tags`, `components` (class-name strings), and `position`, so filtering by tag or component name is one line:

```ts
const enemies = window.__yage__.inspector
  .getEntities()
  .filter((e) => e.tags.includes("enemy"));
```

For agent-driven debugging: write a throwaway Playwright spec, boot the game, freeze the clock, drive scripted input, and snapshot. See `packages/debug.md` → _Agent-driven debugging: throwaway Inspector specs_.

### Unit tests (deterministic frame stepping)

`@yagejs/core` ships headless test utilities. `createTestEngine()` returns a started engine with no renderer/physics/input plugins; plugins must be registered before start, so a test that needs one builds the engine itself (`new Engine()` → `engine.use(...)` → `await engine.start()`). `advanceFrames()` ticks the game loop N times so assertions run against deterministic state:

```ts
import {
  Component,
  Entity,
  Scene,
  Transform,
  advanceFrames,
  createTestEngine,
} from "@yagejs/core";

class Drift extends Component {
  private readonly transform = this.sibling(Transform);
  update(dt: number) {
    this.transform.translate(100 * dt, 0);
  }
}

class Mover extends Entity {
  setup() {
    this.add(new Transform());
    this.add(new Drift());
  }
}

class TestScene extends Scene {
  readonly name = "test";
}

const engine = await createTestEngine();
const scene = new TestScene();
await engine.scenes.push(scene); // async: preload, then onEnter
const mover = scene.spawn(Mover);

advanceFrames(engine, 10);
expect(mover.get(Transform).position.x).toBeGreaterThan(0);
```

The scene and entity use no renderer, physics, or input, because `createTestEngine()` installs none of those plugins.

For component-in-isolation tests, use `createMockScene()` / `createMockEntity()`. See `patterns.md` → Testing Patterns for the full cookbook (component unit tests, system tests, process tests, integration tests).
