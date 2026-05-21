# @yagejs/core

## 0.7.0

### Minor Changes

- [#73](https://github.com/marco-lepore/yage/pull/73) [`069d41e`](https://github.com/marco-lepore/yage/commit/069d41e711aeb6218c1438f52a2b098ff8946526) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Core lifecycle ergonomics: animation fan-out, Transform first-read, scene reentrancy.

  **`@yagejs/renderer` — `LayeredAnimationController`**

  New helper component for multi-layer characters (head + body + outfit). Takes
  a list of sibling `AnimationController` instances and fans `play()` /
  `playOneShot()` across all of them with a single shared lock timer. The
  shared duration is computed once (from the first controller, or an explicit
  `duration` option) and passed to each child as `options.duration`, so every
  layer unlocks on the same frame regardless of per-layer frame counts. The
  master `onComplete` fires exactly once.

  `AnimationController.playOneShot` now accepts a per-call `duration` override
  on solo controllers too (the auto-computed wall-clock value is still the
  default). Doc comment clarifies the canonical pattern for narrowing
  `AnimationController<T>` through `entity.get()` / `sibling()`.

  **`@yagejs/core` — `KeyframeAnimator`**

  `KeyframeAnimationDef.setter` is now optional — omit it for pure-timeline
  tracks that fire only keyframe `event` callbacks (cutscene beats, audio
  cues). Also declared with method syntax so a
  `Record<string, KeyframeAnimationDef<number>>` literal flows into the
  constructor unchanged, without per-key `as` casts or builder helpers
  (previously failed on setter parameter contravariance under
  `strictFunctionTypes`).

  **`@yagejs/core` — `Transform`**

  The constructor leaves `_dirty = true` so the first `worldPosition` /
  `worldRotation` / `worldScale` read recomputes against whatever parent chain
  `addChild` has established by then. Previously, an unparented read before
  parenting completed would lock in a stale local-as-world value.

  **`@yagejs/core` — `SceneManager` reentrancy**

  `push`, `pop`, `replace`, and `popAll` are now safe to call from inside a
  scene lifecycle hook (`onEnter`, `onExit`, `onPause`, `onResume`,
  `beforeEnter`, `afterExit`). The call is queued on the manager's internal
  pending chain and runs after the current mutation finishes; the returned
  promise resolves when the deferred op completes. The previous throw is
  replaced with a dev-only `console.warn` so the smell still surfaces in
  development without breaking the (legitimate) "skip the title scene if a
  save exists" pattern.

- [#69](https://github.com/marco-lepore/yage/pull/69) [`90e4d30`](https://github.com/marco-lepore/yage/commit/90e4d3064d9c2804549d62844067cf487d592f0a) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Dev-mode warnings for common silent-failure modes:
  - `Component.use(Key)` now throws a named error when called at field-init
    time (before the component is bound to an entity), pointing at
    `this.service(Key)` as the lazy alternative.
  - `ColliderComponent.onCollision` on a sensor collider (or `onTrigger` on a
    non-sensor) emits a one-shot dev warning.
  - Asymmetric collision-mask pairs (where Rapier silently drops events) emit
    a one-shot dev warning per `(layers, mask)` tuple.
  - Declaring a scene layer named `"ui"` without `space: "screen"` warns that
    the auto-provisioned UI layer is being shadowed by a world-space layer.
  - A polygon collider whose convex hull drops vertices (concave input) warns
    so the developer can decompose or switch to a polyline.

  All warnings gate on `process.env.NODE_ENV !== "production"` via a new
  `isDev()` / `devWarn()` helper exported from `@yagejs/core` (`@internal`).

- [#66](https://github.com/marco-lepore/yage/pull/66) [`57a6441`](https://github.com/marco-lepore/yage/commit/57a6441f9ef8b5f7140959d6393930c2326d70e0) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Two layer-semantics fixes for scene + layer isolation.

  `LayerDef.isRenderGroup` (renderer): opt-in flag that promotes a layer's container to a Pixi v8 render group, giving it its own uniform scope. Set it on layers that host filtered content AND on any sibling layer whose pipe reads `globalUniforms` directly (`@pixi/tilemap`'s `TilemapPipe.execute` pulls `_activeUniforms.at(-1)`, so a filter elsewhere in the tree can leak its `uWorldTransformMatrix` into the tilemap draw and visibly drift the canopy). Default: `false`.

  `Scene.transparentBelow = false` (the default) is now actually enforced (core + renderer). Pushing an opaque scene on top of a stack hides every below-stack scene tree — world layers AND screen-space UI/HUD. The flag composes through the stack: a below scene stays visible only while every scene above it has `transparentBelow: true`. While a scene transition is running, both the outgoing and incoming scenes render regardless so `crossFade` and friends keep working; the chain is reapplied on `scene:transition:ended`. Previously the flag was documented but no code path enforced it, so UI from scenes below the active scene bled through.

  Breaking: games that relied on the old (unenforced) behavior — below-stack UI continuing to paint through a pushed scene — must either set `transparentBelow = true` on the pushed scene or restructure as a `replace` instead of a `push`.

- [#67](https://github.com/marco-lepore/yage/pull/67) [`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `Scene.emit` + public `Scene.registerScoped`.
  - New `Scene.emit<T>(token, data)` is symmetric to `Entity.emit` — dispatches to scene-level `on` handlers with no entity source. Scene handlers receive `(data, entity?)` where `entity` is `undefined` for scene-emitted events and the source `Entity` for bubbled ones. `Component.listenScene` was updated to mirror the optional `entity` parameter.
  - `Scene.registerScoped(key, value)` is now public. Plugins and game code can attach scene-scoped services that resolve via `Component.use(key)`; they're auto-cleared after scene exit (after plugin `afterExit` hooks see them). The underscore-prefixed `_registerScoped` is kept as an internal alias.

- [#76](https://github.com/marco-lepore/yage/pull/76) [`7ca5050`](https://github.com/marco-lepore/yage/commit/7ca5050d91479121039af5e4898fc0c220e8d7c3) Thanks [@marco-lepore](https://github.com/marco-lepore)! - State layer redesign: `create*` factories, three orthogonal contracts, and id/version moved to the save call site.

  The registry-based `define*` API (per-primitive `id`, baked-in `version`/`migrate`, a global store registry) is replaced by plain factories with no ambient state. The persistence vocabulary is pulled out of the state primitives and into the `@yagejs/save` call site.

  **Three contracts.** Every state factory in `@yagejs/core` returns a value implementing all three; each shape also carries a `[STATE_KIND]` symbol brand, and `useStore` dispatches on the brand instead of duck-typing on method names:

  ```ts
  interface Reactive {
    subscribe(fn: () => void): () => void;
  }
  interface Serializable<TEnc> {
    serialize(): TEnc;
    hydrate(raw: TEnc): void;
  }
  interface Resettable {
    reset(): void;
  }
  ```

  **Factories.** One factory per shape — `createValue`, `createCounter`, `createRecord`, `createMap`, `createSet`, `createList`, and the compound `createStore`. No registry, no per-primitive `id`, no per-primitive `version` / `migrate`:

  ```ts
  import { createStore, createRecord } from "@yagejs/core";

  const game = createStore((s) => ({
    inventory: s.map<string, number>(),
    gold: s.counter({ default: 0 }),
    day: s.value<number>({ default: 1 }),
  }));
  const settings = createRecord<Settings>({
    default: () => ({ music: 0.8, sfx: 1.0 }),
  });
  ```

  `createStore` is the primary surface: one save target, many typed leaves built via `s.value` / `s.counter` / `s.record` / `s.map` / `s.set` / `s.list`. Its `subscribe` aggregates leaf changes so `save.autoPersist` debounces N rapid leaf mutations into one write.

  **Save methods take `(id, thing, opts?)`.** Id and version live at the call site, not on the primitive:

  ```ts
  await save.persist("game", game, { version: 1 });
  await save.restore("game", game, {
    version: 2,
    migrate: (old) => migrateV1ToV2(old as V1),
  });
  await save.saveSlot("game", "manual-1", game, {
    metadata: {
      /* … */
    },
  });
  save.autoPersist("settings", settings);
  ```

  `StoreVersionTooNewError` and `StoreMigrationMissingError` moved from `@yagejs/core` to `@yagejs/save`.

  **`useStore` widens to all `Reactive*` shapes, including compound** (`@yagejs/ui-react`). Same name; one overload per shape plus a selector escape hatch that receives the reactive source itself:

  ```ts
  useStore(record); useStore(counter); useStore(map); useStore(set);
  useStore(list);   useStore(value);   useStore(compound);
  useStore(source, (src) => src.get().score, isEqual?);
  ```

  **Additions over 0.6.0.** `createValue` / `s.value` and `createList` / `s.list` (new shapes); the compound `createStore`; `ReactiveCounter.clamp(value, min, max)`; `entries()` on maps and `values()` on sets now return arrays (were iterators) so React can read them repeatedly without re-iterating.

  **Breaking changes.**
  - All factories renamed `define*` → `create*`. `defineStore<T>(id, opts)` (the old object-record factory) → `createRecord<T>(opts)`; `defineCounter` / `defineMap` / `defineSet` → `createCounter` / `createMap` / `createSet`, with the per-primitive `id` removed.
  - `PersistentLike` and every `Persistent*` type are gone — replaced by `Reactive*` + `Serializable<T>`. `createRecord`'s return type is now a `Reactive*` shape (`ReactiveRecord<T>`), not `PersistentStore<T>`.
  - `PersistentMap.remove` / `PersistentSet.remove` → `.delete` (matches JS-stdlib `Map`/`Set`).
  - The factory default option renamed `defaults` → `default` and now accepts a value or a factory (`default: T | (() => T)`, was `defaults: () => T`). Passing the old `defaults` key is silently ignored and you get the zero/empty default instead — grep call sites, this one fails without a type error in loosely-typed setups.
  - `createAtom` removed — use `createValue`.
  - `@yagejs/ui-react`'s old single-record `createStore` removed — use `createRecord` from `@yagejs/core`.
  - `save.restoreAll` removed — use `Promise.all([save.restore(...), …])`.
  - `_resetAllStoresForTesting` / `_clearStoreRegistryForTesting` removed — there is no registry; construct fresh primitives per test.
  - `useStore`'s selector receives the reactive source, not a snapshot — record selectors that used `(s) => s.score` are now `(src) => src.get().score`.

  **Migration from 0.6.0.** Rename the factory call (`defineStore("id", opts)` → `createRecord(opts)`, `defineCounter("id", opts)` → `createCounter(opts)`, etc.) and move the `id` plus any `version` / `migrate` onto the matching `save.autoPersist` / `save.restore` / `save.persist` call. Group related primitives under one `createStore((s) => …)` when they share a save target. Swap the `defaults:` option key for `default:`, `.remove(` → `.delete(` on map/set, `createAtom` → `createValue`, and any `@yagejs/ui-react` `createStore` import for `createRecord` from `@yagejs/core`.

## 0.6.0

### Minor Changes

- [#56](https://github.com/marco-lepore/yage/pull/56) [`1126143`](https://github.com/marco-lepore/yage/commit/11261436719fed28472cec3143281632f082add5) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add opt-in stable entity identity. Pass `{ key }` as the trailing arg to `scene.spawn(...)` or `entity.spawnChild(...)` to register a per-scene identity key, then look the entity up via `scene.findByKey(key)`. Use `entity.requireKey()` inside component `setup()` when the component depends on identity (e.g. reading from a `defineSet<string>` keyed by entity id).

  The index is lazy (zero cost when unused), per-scene, hides destroyed entities, and clears on scene teardown. Duplicate keys throw at spawn time without leaving an orphan entity. Identity is independent of `@yagejs/save` — it's a primitive game code threads through stores when state should persist.

- [#55](https://github.com/marco-lepore/yage/pull/55) [`e4d8823`](https://github.com/marco-lepore/yage/commit/e4d882380e37a02c8fd259c5019c576a46f9aa89) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Typed reactive stores in core + a new Save IO instance built on them; snapshot system renamed to free the `Save*` namespace.
  - New `core/src/state` module: `Atom<T>` (signal-shaped reactive cell), `Store<T>` (object-shaped, shallow-merge, frozen snapshots), and persistent variants `defineStore<T>` / `defineSet<K>` / `defineMap<K, V>` / `defineCounter` with id, version, migrate, codec, serialize, hydrate.
  - Codec primitives: `Codec<T>`, `jsonCodec`, `setCodec`, `mapCodec`, `dateCodec`.
  - Explicit migration errors: `StoreVersionTooNewError`, `StoreMigrationMissingError`.
  - Internal store registry + `_resetAllStoresForTesting` / `_clearStoreRegistryForTesting` test helpers.

## 0.5.0

### Minor Changes

- [#54](https://github.com/marco-lepore/yage/pull/54) [`cf617fe`](https://github.com/marco-lepore/yage/commit/cf617fe0f28db6ea1a5af7992b76dc19eec8cd0c) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Fullscreen helper, viewport-lifecycle bus events, and a letterbox clipping fix.

  **Fullscreen helper on `RendererPlugin`** (additive)
  - `RendererPlugin.requestFullscreen()` / `exitFullscreen()` / `isFullscreen` getter — wraps the browser fullscreen API with a `webkitRequestFullscreen` fallback for iOS Safari. Targets the configured `container` (so DOM overlays placed alongside the canvas remain inside the fullscreened area), falling back to the canvas when no container was provided.
  - `RendererPlugin.orientation` getter — current `OrientationType`, or `null` when neither `screen.orientation` nor the legacy `window.orientation` angle is available.

  **New typed events on `EngineEvents`** (additive)
  - `screen:fullscreen` with payload `{ active: boolean }` — fired by `RendererPlugin` on `fullscreenchange` / `webkitfullscreenchange` (entering, exiting, Esc, browser UI).
  - `screen:orientation` with payload `{ type: OrientationType }` — fired by `RendererPlugin` on `screen.orientation.change`, falling back to `window.orientationchange` on browsers without the modern API.
  - Listeners install during `RendererPlugin.install()` (gated behind `typeof document/window !== "undefined"` so node-environment tests are unaffected) and tear down in `onDestroy()`.

  **Bug fix: `letterbox` now actually clips world content to the virtual rect**

  `letterbox` and `expand` shared the same transform with no clip, so any game whose world is larger than the virtual rect (e.g. a side-scroller) would render world content into the letterbox bars whenever the host's aspect ratio didn't match virtual. The contract documented for `letterbox` ("leftover canvas painted with `backgroundColor` — bars are blank") was prose-only. Fullscreen made the leak obvious because it forces the container to the viewport's aspect ratio. Under `letterbox` the `FitController` now installs a `Graphics` mask on the stage covering `(0, 0, virtualWidth, virtualHeight)`, restoring the doc'd behaviour. `expand`, `cover`, and `stretch` deliberately don't clip (`expand` is the explicit opt-out for games drawing into bars; the other two cover the canvas already). No API change — existing games on `letterbox` should look the same on aspect-matched hosts and gain proper bar-clipping on mismatched ones.

- [#49](https://github.com/marco-lepore/yage/pull/49) [`bc3790d`](https://github.com/marco-lepore/yage/commit/bc3790dc4c31c42c4821cd275a9376a0830bb0db) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Real gamepad polling, analog sticks/triggers, and `listenForNextKey` support across devices.
  - `Inspector.input.gamepadButton(code, pressed)` and `gamepadAxis(side, value)` now take string identifiers (gamepad code / `GamepadAxisKey`) instead of numeric indices, matching the new `@yagejs/input` API and avoiding the W3C-mapping leak into the public Inspector surface.
  - `InputStateSnapshot.gamepad` updated: `buttons` is now `string[]` (gamepad codes) and `axes` is now `Array<{ key: string; value: number }>` (key format `${padIndex}:${axisName}`), matching what the new `InputManager.snapshotState()` returns.

- [#52](https://github.com/marco-lepore/yage/pull/52) [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Input ergonomics: frame-deferred action edges, pointer/wheel consume primitives, listener parity, and UI auto-consume via the renderer's hit-test fallback.
  - New cross-package consume registry: `markPointerConsumeContainer(c)`, `unmarkPointerConsumeContainer(c)`, `isPointerConsumeContainer(c)` over a module-level `WeakSet`. Used by `@yagejs/ui`, `@yagejs/ui-react`, and `@yagejs/renderer` (sprite opt-in) to flag display containers as UI-input surfaces; `@yagejs/input`'s drain step queries the renderer's `hitTestUI(x, y)` to auto-claim pointer presses landing on any marked container.
  - `RendererAdapter` interface gains an optional `hitTestUI?(x, y): boolean` for renderer implementations to expose a virtual-space hit test. The canonical `@yagejs/renderer` implements it; foreign renderers can omit and the input-side fallback is a no-op.

- [#51](https://github.com/marco-lepore/yage/pull/51) [`114d246`](https://github.com/marco-lepore/yage/commit/114d246820a88e68841a4f9cec2167c188269970) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Multi-pointer / touch support across the input layer.
  - New per-pointer state keyed by `pointerId`: every active mouse, pen, or finger gets its own tracked entry. `getPointers(): readonly PointerInfo[]` and `getPointer(id): PointerInfo | undefined` expose them; `PointerInfo` carries `{ id, screenPos, type, isPrimary, buttons, isDown }`.
  - `pointerType` (`"mouse" | "pen" | "touch"`) is now exposed on every tracked pointer so games can branch on input class (e.g. show or hide a hover indicator).
  - Per-pointer event hooks: `onPointerDown(fn)` / `onPointerUp(fn)` / `onPointerMove(fn)` each return a disposer. Up listeners also fire on `pointercancel`, so gesture-tracking code does not need to special-case it.
  - `MouseLeft` / `MouseMiddle` / `MouseRight` action codes now use any-pointer aggregation (mirrors the Tier 1 gamepad fix): two simultaneous pointers holding button 0 emit one down edge and one up edge, never spurious duplicates.
  - The singular `getPointerPosition()`, `getPointerScreenPosition()`, and `isPointerDown()` continue to report the **primary** pointer (the one the browser flagged `isPrimary`), so existing single-pointer call sites keep working unchanged. `isPointerDown()` now reflects "primary pointer has any of buttons 0/1/2 held" — buttons 3+ no longer set it.
  - Synthetic injection (`firePointerMove` / `firePointerDown` / `firePointerUp`) gains an optional second `opts?: { id?, type?, isPrimary? }` argument for driving non-primary or touch pointers in tests. Existing zero-arg / single-arg calls keep their previous semantics.
  - `InputStateSnapshot` (from `@yagejs/core`) now exposes a `pointers: PointerSnapshot[]` array next to `mouse`. `mouse` is preserved as a primary-pointer mirror for back-compat with existing inspector tooling.
  - `pointercancel` now drops the cancelled pointer entirely and releases the aggregate `MouseLeft`/`Middle`/`Right` edges it was holding — replaces the previous "clear all pointer buttons" handling, which over-cleared when only one of multiple touches was cancelled.

## 0.4.0

### Minor Changes

- [#45](https://github.com/marco-lepore/yage/pull/45) [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Inspector deterministic test mode and per-package serialization plumbing for `Inspector.snapshot()`.
  - New `Inspector` capabilities: full deterministic state via `snapshot()` / `snapshotJSON()` (stable-sorted), per-scene snapshots via `snapshotScene()`, recorded event log (`events.getLog()` / `clearLog()` / `setCapacity()` / `waitFor(pattern, { withinFrames, source })`), synthetic-input drivers (`input.keyDown`/`Up`, `mouseMove`/`Down`/`Up`, `gamepadButton`/`Axis`, `tap`/`hold`/`fireAction`), manual frame stepping (`time.freeze`/`thaw`/`step`/`setDelta`/`isFrozen`), seed control (`setSeed`, `createSceneRandom`), and PNG capture (`capture.png`/`dataURL`/`pngBase64`).
  - Generic `addExtension(namespace, api)` / `getExtension<T>(namespace)` / `removeExtension(namespace)` so plugins can publish optional inspector helpers under their own namespace; extensions are cleared on `dispose()`.
  - New deterministic RNG: `RandomService` (interface), `RandomKey` (scene-scoped service), `createRandomService(seed?)`, `globalRandom`, `normalizeSeed`, `createDefaultRandomSeed`. `setSeed` is intentionally off the public interface — game code can't reset a shared per-scene RNG mid-frame; only the Inspector reseeds via the internal subtype.
  - New types exported from `index.ts`: `EngineSnapshot`, `WorldSceneSnapshot`, `WorldEntitySnapshot`, `ComponentStateSnapshot`, `UITreeSnapshot`, `UINodeSnapshot`, `PhysicsSnapshot`, `CameraSnapshot`, `InputStateSnapshot`, `EventLogEntry`, `InspectorTimeController`, `RandomService`.
  - Scene-scoped DI now resolves `RandomKey` automatically when the engine starts; `Scene._setEntityEventObserver(...)` exposes a tooling-only entity-event tap consumed by the inspector log.
  - Breaking: `EngineSnapshot.frameCount` removed (use `frame`). `RandomService` no longer exposes `setSeed` publicly (use `Inspector.setSeed`).

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
