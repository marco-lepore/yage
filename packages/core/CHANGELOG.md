# @yagejs/core

## 0.3.0

### Minor Changes

- [#35](https://github.com/marco-lepore/yage/pull/35) [`69f8449`](https://github.com/marco-lepore/yage/commit/69f844942d1596228a6ed50a37ec8e6f1d821353) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `SceneManager.autoPauseOnBlur` — opt-in automatic scene pause on tab hide/show.
  - New flag on `SceneManager` (default `false`). When enabled, pauses every scene in `activeScenes` on `document.hidden === true` and restores only those scenes on return — user-paused scenes (manual `scene.paused = true` or `pauseBelow` cascade) are never touched. Toggling the flag off mid-blur unpauses immediately.
  - `SceneManager` attaches its own `visibilitychange` listener in `_setContext` and tears it down in `_destroy`. Guarded for non-browser environments.

- [#33](https://github.com/marco-lepore/yage/pull/33) [`60d2067`](https://github.com/marco-lepore/yage/commit/60d20671e31230f5fcef127203efb127bdfedf92) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add common math and vector helpers: angle interpolation, inverse lerp, ping-pong, smooth damp, and `Vec2.moveTowards`.

- [#36](https://github.com/marco-lepore/yage/pull/36) [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `RendererAdapterKey` — a cross-package contract for "something that owns
  a canvas and can map canvas-relative CSS pixels into virtual-space pixels".
  The canonical `@yagejs/renderer` plugin registers itself under this key, and
  `@yagejs/input` resolves it automatically so pointer events target the
  correct canvas and coordinates route through `canvasToVirtual` out of the
  box. Foreign renderers can implement `RendererAdapter` and register under
  the same key to integrate with `@yagejs/input` without pulling in
  `@yagejs/renderer`.

  New exports: `RendererAdapterKey`, `RendererAdapter`.

## 0.2.0

### Minor Changes

- [#29](https://github.com/marco-lepore/yage/pull/29) [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `Entity.scene` and `Entity.spawnChild` — cleaner entity composition.

  **`Entity.scene` now throws when the entity is detached** (was: returned `Scene | null`). Inside lifecycle code (`setup`, component `onAdd` / `update`, event handlers on an attached entity) the scene is always non-null by construction, so the previous nullable return type forced noisy `!` / `?.` at every callsite. The throwing variant mirrors what `Component.scene` already did and removes that noise.

  A new **`Entity.tryScene`** getter preserves the nullable return for the rare case where defensive null-awareness is genuinely needed (systems iterating a query result that may include entities mid-destroy, etc.). Migration for the handful of callsites that relied on the nullable return is a one-liner rename.

  **`Entity.spawnChild` collapses** the common two-step "spawn an entity in the scene, then parent it" dance into one call, mirroring `Scene.spawn`'s overload shape. Three forms:

  ```ts
  // 1. With an Entity subclass (optionally with setup params)
  this.spawnChild("body", EnemyBody, { color: 0xff6b6b });

  // 2. With a Blueprint (optionally with params)
  this.spawnChild("tag", Nameplate, { label: "Grunt" });

  // 3. Anonymous — no factory, just a named slot
  const ui = parent.spawnChild("ui");
  // ui.name === "ui"  (child-map key doubles as entity name)
  ```

  Use the anonymous form when you want an empty child to compose components onto imperatively without declaring an Entity subclass. Returns the spawned child for chaining. Throws if the parent is detached (same policy as the new `scene` getter) and validates name uniqueness before spawning so a duplicate-name error leaves no orphan in `scene.entities`.

- [#26](https://github.com/marco-lepore/yage/pull/26) [`fc717ba`](https://github.com/marco-lepore/yage/commit/fc717bac2bc530a2c396da604d614f762d272232) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `LoadingScene` — orchestration base class for loading screens.
  - Preloads `target.preload` through the engine's `AssetManager`, emits `scene:loading:progress` and `scene:loading:done` on the event bus, and hands off to `target` via `scenes.replace` (optionally through a `SceneTransition`).
  - Loading is kicked off by calling `this.startLoading()` — usually at the end of `onEnter` after spawning the loading UI. Deferring the call gates the start of the load on a title screen, intro animation, or "press any key to start" without any extra flag.
  - `target` accepts a `Scene` instance or a factory `() => Scene`.
  - `minDuration` (ms) keeps the loading scene on screen long enough to avoid flicker on cached loads.
  - `autoContinue` (default `true`) can be set `false` to gate the handoff behind a manual `scene.continue()` call — enables "press any key to continue" flows.
  - `progress` getter (0 → 1) for ad-hoc reads; primary consumption is via the new bus events.
  - `onLoadError` hook for retry / error UIs. The scene stays mounted on failure; call `startLoading()` from the hook to retry, or leave the default (error logged via the engine logger, scene remains in a failed state).
  - Extends `EngineEvents` with `scene:loading:progress` and `scene:loading:done` event keys.

  LoadingScene does not render; spawn an entity in `onEnter` (the default is `LoadingSceneProgressBar` in `@yagejs/ui`) or any component that subscribes to the loading events.

- [#20](https://github.com/marco-lepore/yage/pull/20) [`6143e03`](https://github.com/marco-lepore/yage/commit/6143e0346820dd74d78b1d345ac4ebc5e4294769) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add scene-scoped DI and generic scene hooks.
  - `ServiceKey` now accepts a `{ scope: "scene" }` option. Scene-scoped services are registered per-scene (via `beforeEnter` hooks) and automatically cleared when the scene exits.
  - New `SceneHooks` interface (`beforeEnter` / `afterExit`) and `engine.registerSceneHooks(hooks)` API for plugins to set up and tear down per-scene state.
  - `Component.use(key)` resolves scene-scoped keys against the active scene's service map automatically.

- [#22](https://github.com/marco-lepore/yage/pull/22) [`083b05b`](https://github.com/marco-lepore/yage/commit/083b05bd9c9557ef32b9b82939e792983c4a5f9b) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add scene transition system with push/pop/replace support, and rework the scene-manager cancellation story.

  **Breaking:**
  - `SceneManager.pop()` now returns `Promise<Scene | undefined>` (was synchronous).
  - `SceneManager.clear()` is replaced by `SceneManager.popAll()`. `popAll` is async and queued — it waits for any in-flight transition and pending ops to drain, then pops every scene top-to-bottom. It does **not** cancel in-flight work (the previous `clear()` did). `Engine.destroy()` keeps a synchronous teardown path via an internal helper.
  - New `SceneTransition` contract: `begin` / `tick` / `end` lifecycle with `SceneTransitionContext`.
  - `SceneManager.push()`, `.pop()`, `.replace()` accept `{ transition }` option.
  - `Scene.defaultTransition` — per-scene default used when no call-site transition is provided.
  - `Scene.isTransitioning` / `SceneManager.isTransitioning` reflect active transition state.
  - New events: `scene:transition:started`, `scene:transition:ended`. Both carry `{ kind, fromScene, toScene }` (scenes may be `undefined`).
  - Concurrent scene ops queue via `_pendingChain`. Reentrant calls from scene lifecycle hooks throw with a message pointing to `queueMicrotask` / component `update()` as the right place to defer.
  - `Plugin.onStart` is typed `void | Promise<void>` — `Engine.start()` already awaited it; the type now matches.
  - `SceneManager` rejects non-finite transition durations (NaN/Infinity) at the orchestration layer instead of looping forever in `_tickTransition`.
  - Core ships the contract + orchestration only; concrete transitions live in `@yagejs/renderer`.
