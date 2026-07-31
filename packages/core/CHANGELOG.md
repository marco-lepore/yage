# @yagejs/core

## 0.10.0

### Minor Changes

- [#212](https://github.com/marco-lepore/yage/pull/212) [`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Errors thrown inside code the engine calls on your behalf — event listeners, collision handlers, process callbacks, a system or component's own `update()`, scene lifecycle hooks — are now attributed to the culprit instead of surfacing from wherever the throw happened to reach: the engine reports it with its stack, then rethrows.
  - `System`/`Component` update failures, and every developer callback the engine invokes (event handlers, collision/trigger handlers, input listeners, process callbacks, audio unlock callbacks), are recorded and logged through `Logger` with the original `Error`, then rethrown. Nothing is disabled, unsubscribed, muted, or cancelled.
  - `GameLoop.tick()` is the one place that decides a failure is terminal: an error that escapes an entire frame unhandled stops the loop and rethrows, so it reaches your own `try`/`catch`, `window.onerror`, or an unhandled-rejection handler. An error your own code catches inside the frame — around `entity.emit(...)`, for instance — leaves the loop running.
  - Scene lifecycle hooks (`onEnter`, `onExit`, `onPause`, `onResume`, plugin `beforeEnter`) are reported the same way, and a synchronous throw is rethrown — a half-built scene must not look like it mounted cleanly. An async hook's rejection can only be reported: the call has already returned by the time it settles.
  - `Logger` prints every accepted entry through `console.*` by default in dev builds, so `logger.error` calls (including the ones above) are visible without configuring an `output` sink. The default drops out of a production build; passing your own `output` always overrides it. A throwing `output` sink is caught, logged once, and disabled for the rest of the session instead of escaping into whatever it was trying to report.
  - `Inspector.getErrors()` returns a `callbackErrors` array — a bounded history (the 200 most recent failures) with each entry's kind and owning entity/scene/event where known.

- [#214](https://github.com/marco-lepore/yage/pull/214) [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Entities can now be turned off and reused instead of destroyed and respawned: `entity.setActive(false)` puts an entity and its whole subtree to sleep, and components get `onEnable` / `onDisable` to release and reacquire live resources.
  - `Entity` gains `activeSelf` (own bit), `isActive` (own bit and every ancestor's), and `setActive(active)`. Descendants follow their parent while keeping their own `activeSelf`.
  - `Component` gains `onEnable()` / `onDisable()`, fired when `component.enabled && entity.isActive` changes, and `effectiveEnabled` to read that state. Order is `onAdd` → query join → `onEnable` on add, and `onDisable` → `onRemove` / `onDestroy` on teardown. A throwing hook is attributed to its component and rethrown, like a throwing `update()`.
  - `Component.enabled` is an accessor rather than a plain field, so writing it fires the hooks. Deactivating an entity does not write per-component `enabled` flags — a component you disabled by hand stays disabled.
  - Dormant entities leave every `QueryCache` query and are excluded from `scene.findEntity`, `scene.findEntitiesByTag`, `scene.findEntities`, and `filterEntities`. `scene.getEntities()` and `scene.findByKey` still return them.
  - `ComponentUpdateSystem` and `ProcessSystem` skip dormant entities, so a dormant entity's components and processes pause rather than keep running. `QueryCache` gains `onEntityActivated` / `onEntityDeactivated`, and `EntityCallbacks` carries both.
  - Both Inspector entity snapshot shapes gain an `active` field, component state reflection reports `enabled`, and camera lookup skips dormant entities. `getEntityByName`, `getEntityPosition`, `hasComponent`, and `getComponentData` resolve names through `scene.findEntity` and so read a dormant entity as absent — `getEntities()` is where its `active: false` entry shows up.

- [#219](https://github.com/marco-lepore/yage/pull/219) [`f1048ab`](https://github.com/marco-lepore/yage/commit/f1048ab756feee84e593609521c3a58fcfc1c1a7) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `entity.handle()` gives a reference that expires with the entity's current life, so code holding on to an entity someone else retires can tell that it is gone. A pooled entity is reused, and a released member is alive with `isDestroyed` still `false`, so a plain stored reference silently follows the object into its next life — a turret keeps tracking what is now a different enemy.
  - `entity.handle()` returns an `EntityHandle<T>`, read through `.current`: the entity while that life lasts, `undefined` afterwards. `EntityHandle` is a type; `handle()` is the only way to make one.
  - `.current` means "the same life", not "active right now" — an entity switched off with `setActive(false)` still resolves.
  - A life ends on `destroy()`, on scene teardown, on every path that returns a pool member (`release`, `releaseAll`, a `forceAcquire` reclaim), and on `dispose()`, which destroys the members. A member's descendants end their lives with it.
  - `entity.generation` is the counter behind it: per entity, 0 to start, increased whenever a life ends. Compare it for equality — a destruction cascade can advance it more than once, so it does not count lives. It stays out of save and Inspector snapshots.
  - `handle()` on a pool member the pool is not lending out returns a handle that never resolves, and warns in dev builds — the caller only has a stale reference at that point.
  - Guidance: use a handle whenever pooled entities are involved; a plain reference is fine for entities that live as long as the scene, or when the code storing the reference also controls when the entity goes away.

- [#216](https://github.com/marco-lepore/yage/pull/216) [`4a5b3b6`](https://github.com/marco-lepore/yage/commit/4a5b3b639ddcbb285b6a4733b89d27bcee14c50c) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `EntityPool` reuses a fixed group of entities instead of spawning and destroying one per shot. Members are built once and cycled by deactivation, so their physics bodies, display objects and component instances stay allocated between lives.
  - `new EntityPool(scene, Bullet, options)` with `acquire` / `forceAcquire` / `release` / `releaseAll` / `dispose`, and `size` / `leased` / `free` counters. Options: `prewarm`, `maxSize`, `reclaimPriority`, and the entity's `setup` params when its `setup()` requires them.
  - A pooled class declares `onAcquire(...)`, whose parameters become `acquire`'s arguments; `onRelease()` is optional. Both are hooks on `Entity`, and the pool's generic constraint rejects a class that declares no `onAcquire`.
  - Elastic by default: the pool grows and `acquire` returns the entity. With `maxSize` a saturated `acquire` returns `undefined` — and the return type widens to match — while `forceAcquire` reclaims the lowest-`reclaimPriority` member in flight, default oldest-acquired.
  - Pool members are built dormant, so they never join a query or fire an enable hook on the way in. Children a member's `setup()` spawns inherit that.
  - `entity.isPooled` marks a member so the save layer can skip it, and pools register with their scene: scene exit disposes them, and a disposed pool throws on `acquire`.
  - A pool owns its members' lifetimes. `entity.destroy()` on a member returns it to its pool rather than tearing it down, so a collision handler or update holding a plain `Entity` can retire it without a pool reference, and the same code works whether or not the entity is pooled. Destroying an entity that has a member below it detaches and returns that member. `isDestroyed` stays `false` for a released member, and only `dispose()` destroys members.
  - `Scene` exports `SetupParamTuple`, the `setup()` parameter tuple the spawn and pool signatures are derived from.

- [#207](https://github.com/marco-lepore/yage/pull/207) [`d459026`](https://github.com/marco-lepore/yage/commit/d4590265b9aa5297fb99d20b92bb5a2f19cac0c5) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Inspector improvements for verifying games headlessly: default component introspection, awaitable stepping, stall detection, and event-log control.
  - Component snapshots now include a component's public fields and getters even when it defines no `serialize()`. `inspector.getComponentData()` and `inspector.snapshot()` show live state by default instead of `null`.
  - Added `inspector.time.stepUntil(predicate, { maxFrames })` and `inspector.time.stepAsync(frames)` — awaitable stepping that lets async work such as scene transitions advance between frames while the clock is frozen. `stepUntil` throws if the predicate is not met within `maxFrames` (default 600).
  - Added `inspector.time.isAdvancing(withinMs)` — reports whether real frames are ticking, a stall signal distinct from `isFrozen()`.
  - Added `inspector.events.setEnabled(enabled)` and `inspector.events.isEnabled()` to turn Inspector event logging on or off at runtime; turning it off stops per-event allocation.
  - `inspector.snapshotScene(nameOrId)` now accepts a scene's name, not just its internal id, and `inspector.getSceneStack()` entries include the scene id.

### Patch Changes

- [#213](https://github.com/marco-lepore/yage/pull/213) [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Remove the duplicate `scene-` prefix from Inspector snapshot IDs for scenes with multiple UI roots.

## 0.9.0

### Minor Changes

- [#201](https://github.com/marco-lepore/yage/pull/201) [`0574e44`](https://github.com/marco-lepore/yage/commit/0574e44d68df2568c57d0275aff139bddebb06da) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Make class-based entity spawning safe for addon-authored setup hooks.
  - Add `entityClassHasTrait()` for checking inherited traits before spawning an entity class.
  - Remove a class-spawned entity and its descendants immediately when its `setup()` method throws, then rethrow the original error.

- [#166](https://github.com/marco-lepore/yage/pull/166) [`3f7a367`](https://github.com/marco-lepore/yage/commit/3f7a367edc5af8d0d78e6e95bcc709bd8b77d783) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `Process.elapsed` — seconds accumulated from the dt the process is ticked with, so it reflects any time scaling applied by the caller. Does not advance while paused.

- [#153](https://github.com/marco-lepore/yage/pull/153) [`a5d7d53`](https://github.com/marco-lepore/yage/commit/a5d7d5370fb8db567f4ceb39934574ab5c37a174) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `createList` / `s.list` accept an optional `keyBy` to look up items by a domain field in O(1). With it, `ReactiveList` exposes `findId(key)`, `getByKey(key)`, and `upsert(key, item)` — useful for inventories or registries keyed by something like an `itemId`. The key index is derived, so existing saves load unchanged.

- [#200](https://github.com/marco-lepore/yage/pull/200) [`22f8534`](https://github.com/marco-lepore/yage/commit/22f8534e8dbc9ef054c23a570ab851f8710db68f) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Allow `ProcessComponent` and `TimerEntity` to cancel and unregister an owned `ProcessSlot` by handle with `removeSlot()`.

- [#163](https://github.com/marco-lepore/yage/pull/163) [`da97f10`](https://github.com/marco-lepore/yage/commit/da97f10ba7cb7627f48efccf3bfe1836bfac3dbc) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `RendererAdapter` gains an optional `visibleVirtualRect` — the on-screen region of virtual space clamped to the declared virtual rect, fresh per access. Renderer-agnostic screen-space overlays lay out against it instead of mapping canvas corners through `canvasToVirtual`: under letterbox fit the corners extend into the masked bars, where drawn content is clipped invisible while pointer input still lands. `RendererPlugin` already exposes the getter and now declares the adapter interface, so the member is compile-checked.

- [#192](https://github.com/marco-lepore/yage/pull/192) [`f6c2fa8`](https://github.com/marco-lepore/yage/commit/f6c2fa8e508620fb5356b8e4481a199115a73a45) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Snapshot restore order is now driven by a `restorePriority` static on each component class.
  - New `Component.restorePriority` static: on load, an entity's components are re-added in ascending priority (undeclared = 100, engine components reserve 0-99), so a component whose `onAdd()` reads a sibling can rely on lower-priority siblings being present. Subclasses inherit the base class's value unless they declare their own.
  - `Transform` declares priority 0 — it restores before every other component.

- [#191](https://github.com/marco-lepore/yage/pull/191) [`10d3ac5`](https://github.com/marco-lepore/yage/commit/10d3ac5ec3f3dca593f35728b175df3bfd073bb6) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Scene lifecycle signals: teardown gets full destroy semantics, and `onPause`/`onResume` fire on every effective pause transition.
  - Scene teardown (`pop`, `replace`, engine shutdown) now marks every entity destroyed before any component `onDestroy` runs, and emits `entity:destroyed` once per entity — including entities queued with `destroy()` but not yet flushed. Cached references and lifetime-tracking listeners see the same contract on both destroy paths.
  - After destruction — end-of-frame flush or scene teardown — `entity.scene` throws and `entity.tryScene` returns `null`. Component `onDestroy` hooks still see the scene; the entity detaches after component teardown.
  - `Scene.paused` is now an accessor: assigning it fires `onPause`/`onResume` when the effective pause state (`isPaused`) flips. Manual pauses, `autoPauseOnBlur`, and snapshot restore of a paused scene all reach the hooks; writes that don't change the effective state (repeated assignments, flips masked by a stack pause, pre-push writes) fire nothing. To start a scene paused, set `paused = true` before pushing it; writing `paused` from inside a lifecycle hook races the transition's pause diff and logs a dev-mode warning.

- [#189](https://github.com/marco-lepore/yage/pull/189) [`8a933db`](https://github.com/marco-lepore/yage/commit/8a933db95eedb908ad98e95631d5022fe1e0ef28) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `SceneTime`: per-scene arbitration for time effects — hitstop, slow motion, bullet time, freeze frames.
  - New per-scene `SceneTime` service under the scene-scoped `SceneTimeKey`, registered by the engine for every scene. `scaleBy(factor, { for?, key?, excludeUpdates?, label? })` and `freezeFor(duration, { key?, label? })` return idempotent `TimeEffectHandle`s. Each `key` is a channel: within a channel the latest active request wins (older still-active entries apply again when it ends); across channels winners multiply; freeze is a ×0 factor. `scene.timeScale` stays the game's persistent knob and is never written by the service: `effectiveScale = scene.timeScale × channel winners`.
  - Component updates and `ProcessComponent` ticks run under the per-entity `effectiveScaleForUpdates(entity)`, so `excludeUpdates` keeps chosen entities (e.g. a bullet-time caster) at full speed; `entity.timeScale` composes on top and is never written. Scene-pool processes run at the full `effectiveScale`.
  - Request durations age on raw frame time at the start of each frame and hold while the scene is stack-paused; all requests release on scene exit, and effects are transient across save/load.
  - `Scene.tryResolveScoped(key)` is public: read a scene-scoped service without engine-scope fallback.
  - Inspector scene snapshots gain `effectiveTimeScale` and `frozen`.

- [#159](https://github.com/marco-lepore/yage/pull/159) [`9b637bc`](https://github.com/marco-lepore/yage/commit/9b637bcd832476a6c47eb4dacb8cf33e9c5139b0) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Change the engine time unit from milliseconds to seconds.

  `Component.update(dt)` / `fixedUpdate(dt)` now receive seconds (~0.0167 at 60fps) instead of milliseconds. `EngineConfig.fixedTimestep` defaults to `1/60` and is expressed in seconds. All duration-based APIs follow: `Process.delay`, `ProcessSlot`/`ProcessComponent.slot` durations, `Tween`/`Sequence.wait`/`Tween.stagger` step, `KeyframeTrack` keyframe `time`, `LoadingScene.minDuration`, scene-transition durations (`fade`/`flash`/`crossFade`/`iris`/`irisReveal`/`chessboard`/`slidePush`), `CameraComponent.shake`/`zoomTo`, `AnimationController.playOneShot`, and effect durations/fades (`hitFlash`, `shockwave`, `fadeIn`/`fadeOut`) are all in seconds.

  Migration: drop any `dt / 1000` conversion in your `update`/`fixedUpdate` code, and pass durations in seconds (e.g. `300` ms becomes `0.3`).

- [#154](https://github.com/marco-lepore/yage/pull/154) [`9b02d02`](https://github.com/marco-lepore/yage/commit/9b02d024fe54ea30efef01a109387b839266b791) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Omitting a required `setup()` field in `scene.spawn(Class, params)` or `entity.spawnChild(name, Class, params)` reports the missing field by name (`Property 'X' is missing`) instead of a confusing `SpawnOptions` error.

  The class form derives its params slot from the `setup` parameter itself: a required parameter makes the params argument required (`spawn(Class)` is a type error even when the parameter object's fields are all optional), and the params slot only accepts the setup param type — a `SpawnOptions`-shaped literal is no longer silently accepted where params belong.

- [#172](https://github.com/marco-lepore/yage/pull/172) [`8d061c5`](https://github.com/marco-lepore/yage/commit/8d061c54eb0bbf3aed75b2b943fef1affdce7667) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Fixes a `useQuery` leak in `@yagejs/ui-react`: every mounted component registered a live query in the engine-wide `QueryCache` with no way to release it.
  - `QueryCache` gains `unregister(result)` to stop a registered query from receiving further `onComponentAdded`/`onComponentRemoved` updates. A second call (or a result that was never registered) is a no-op. Queries registered once at system-install time (`DisplaySystem`, `UILayoutSystem`) are engine-lifetime by design and are unaffected.

### Patch Changes

- [#194](https://github.com/marco-lepore/yage/pull/194) [`8156b6d`](https://github.com/marco-lepore/yage/commit/8156b6dcc8429b738c3efeb949fafd1cce245330) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Rename the UI element/Component split so the `UI*` prefix uniformly means "renderable UIElement".
  - The Inspector's UI-tree snapshot recognizes the renamed root component: it matches components named `UISurface` with a `root` element (previously `UIPanel` with `_node`) and emits `entity-<id>:UISurface:<i>` node ids.

## 0.8.0

### Minor Changes

- [#121](https://github.com/marco-lepore/yage/pull/121) [`62da81f`](https://github.com/marco-lepore/yage/commit/62da81f67076fccaff3a8af6c805dd919c6a687f) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Reference-count shared assets so a font or texture held by more than one owner survives until the last release.
  - `AssetManager` now reference-counts loads by `type:path`. Every `loadAll` adds a reference — including for already-cached handles — and `unload` invokes the loader's `unload` (and drops the cache entry) only when the last reference is released; earlier calls just decrement. Two scenes preloading the same asset no longer tear it out from under each other on the first `unload`. `clear` still frees everything outright, ignoring counts. Behaviour is unchanged for an asset loaded once.

- [#112](https://github.com/marco-lepore/yage/pull/112) [`8e2ab0b`](https://github.com/marco-lepore/yage/commit/8e2ab0b301748c2ac5f3d90224d3a2cc92393865) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add a per-entity `timeScale` multiplier (closes [#92](https://github.com/marco-lepore/yage/issues/92)).
  - `Entity.timeScale` (default `1`) scales the delta time the engine feeds an
    entity's components: `dt * scene.timeScale * entity.timeScale`. It composes
    on top of the scene's `timeScale`, so `0` freezes a single entity while the
    scene keeps running and `2` runs it at double speed.
  - Applies to component `update()` / `fixedUpdate()`
    (`ComponentUpdateSystem`), the entity's `ProcessComponent` tween tick
    (`ProcessSystem` — scene-scoped processes stay scene-only), and the entity's
    particle emitters (`ParticleSystem`).
  - Physics is deliberately carved out: a scene shares one Rapier world stepped
    once per (scene-scaled) fixed tick, so a rigid body cannot be individually
    time-scaled. Use `scene.timeScale`, a kinematic body, or manual velocity
    scaling for per-body time control.
  - `entity.timeScale` is captured and restored by the save snapshot (omitted
    from the snapshot when left at the default to keep saves compact).

- [#114](https://github.com/marco-lepore/yage/pull/114) [`555a868`](https://github.com/marco-lepore/yage/commit/555a86888ec3aedca42587fab7eb3ec5f0c6eeb8) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add a derived rendered-geometry / visibility facet to the Inspector snapshot, wired through a generic facet-contributor seam so `@yagejs/core` stays renderer-agnostic.
  - `@yagejs/core`: the Inspector gains a generic facet seam — `registerFacetContributor()` lets a plugin attach a namespaced facet (`InspectorFacetContributor`) to component and entity snapshots, surfaced under an open `facets?: InspectorFacets` map on `WorldEntitySnapshot` and `ComponentStateSnapshot`. Core knows nothing about rendering: it just invokes each registered contributor per component (tolerating an absent or throwing hook), lets the contributor pick an entity-level facet, attaches results under their namespace, and keeps everything out of `serialize()`. This mirrors the contributor pattern already used by `DebugContributor` and save's `SnapshotContributor`. No Pixi or renderer concept leaks into core.
  - `@yagejs/renderer`: now owns the render facet end-to-end. Exports `RenderFacetSnapshot<Extra>` (moved out of core) and a `RenderFacetContributor` that `RendererPlugin` registers with the Inspector on install (removed on teardown). The contributor duck-types `inspectRender()` off each graphical component and surfaces the first painted component at the entity level. `SpriteComponent`, `AnimatedSpriteComponent`, `GraphicsComponent`, `TextComponent`, and `SplitTextComponent` expose `inspectRender()` — a compute-on-demand, read-only method deriving the live display object's world-space bounds and visibility from `getLocalBounds()` (leaving the scene graph's cached transforms untouched). `SplitTextComponent` additionally reports per-glyph visibility (`glyphs`) and the visible substring (`visibleText`), so a typewriter reveal is observable from the public Inspector API. Read the facet at `snapshot.entities[].facets?.render` / `component.facets?.render`; `bounds` are world-space pixels measured from the geometry itself (a sized-but-hidden object still reports its real box; `null` only for genuinely empty/zero-area geometry, with `visible` carrying the hidden/shown state).

- [#98](https://github.com/marco-lepore/yage/pull/98) [`3991288`](https://github.com/marco-lepore/yage/commit/39912883cf191cd065ef0b5779f1b65b53bcbea8) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add split text for per-glyph / animated text — typewriter reveals, per-letter colour / wave, staggered line entrances.

  Wraps Pixi v8's experimental `SplitText` / `SplitBitmapText` and exposes the text as arrays of individually transformable display objects — `chars` (per-glyph `Text` / `BitmapText`), `words`, and `lines`.
  - **`@yagejs/renderer` — `SplitTextComponent`** (free-positioned, Transform-synced, layer-attached like `TextComponent`). `chars` / `words` / `lines` getters, `setText` / `setStyle`, `charAnchor` / `wordAnchor` / `lineAnchor` segment pivots, `resplit()` for batching under `autoSplit: false`, `tint` / `alpha`, the underlying `splitText` escape hatch, and the `bitmap` discriminator. Serializable.
  - **`@yagejs/ui` — `UISplitText`** (Yoga-laid-out UI element). Same segment API plus an `onSplit` subscription that fires whenever a re-split invalidates `chars`. Measures its natural size via Pixi's text metrics (stable under per-glyph animation). No `truncate` / word-wrap — pre-break with `\n` or use `UIText` for flowing paragraphs.
  - **`@yagejs/ui-react` — `<SplitText>` + `useSplitText`**. `useSplitText()` returns a `[ref, controls]` tuple: live `chars` / `words` / `lines` / `segments` accessors, `resplit()`, and `run(process | process[])`. `run` enqueues on a scene-scoped process queue (pauses with the scene; cancelled on unmount and on re-split so a tween never targets a destroyed glyph) and returns a `{ cancel() }` handle for that batch. Animate imperatively from any handler rather than binding up front.
  - **`@yagejs/core` — `Tween.stagger(items, factory, stepMs)`**. Maps a `Process` factory over an array, staggering each item's start by `stepMs` (the factory runs at start time, so a `Tween.to` reads its `from` then). Pairs with `useSplitText`'s `run` to cascade a tween across `chars` / `words` / `lines`.

  `SplitText` is flagged experimental in Pixi and re-lays-out on every `text` / `style` change — prefer `TextComponent` / `UIText` for static or simple dynamic strings.

- [#97](https://github.com/marco-lepore/yage/pull/97) [`23e357f`](https://github.com/marco-lepore/yage/commit/23e357f605957cc24e58ec2e504a82d4ebdcc9a0) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Web-font asset handle, engine-level default text style, and bitmap-font DX.
  - New `webFont(path, { family })` asset factory (wired as the renderer `"web-font"` loader) — a declarative `AssetHandle` for loading a plain `.ttf`/`.woff`/`.woff2` as a canvas `Text` font, resolvable through `Scene.preload` (the canvas sibling of `bitmapFont`). The `family` registers the `@font-face`; omit it to let Pixi derive it from the file name. To carry that metadata, `AssetHandle` gains an optional third `data` argument, forwarded to `AssetLoader.load(path, data)` (backward-compatible — existing loaders ignore it).
  - Engine-level default text style: `RendererConfig.defaultTextStyle` sets an app-wide base under every `TextComponent` / `UIText` `style`, and `UIPlugin({ defaultTextStyle })` layers a UI-only override on top. Precedence: per-text `style` → `UIPlugin` default → `RendererPlugin` default → Pixi default. Re-applied on `setStyle` so a recolour keeps it — no more importing `pixi.js` to touch `TextStyle.defaultTextStyle`. The renderer-level mutation is captured/restored on plugin destroy, like `pixelArtPreset`.
  - `bitmap` is now a plain `boolean` on `TextComponent` / `UIText` / `<Text>` / `UIButton` (**breaking**: the `{ font, size }` object form is removed, and the `BitmapTextOption` type is no longer exported). The bitmap font is a normal style property — pass the installed/baked font name as `style.fontFamily` (and the glyph size as `style.fontSize`) alongside `bitmap: true`. `installBitmapFont` still returns that name.
  - New `mergeStyle(style)` on `TextComponent` / `UIText`: patches the current style instead of replacing it, so an imperative recolour (`mergeStyle({ fill })`) keeps the font, size, weight, etc. `setStyle` remains a full replace (the semantics the React reconciler relies on).
  - `bitmap` DX: passing `bitmap` nested inside `style` (a silent no-op before) now emits a dev-mode warning, surfaced on every construction and `setStyle` path. `UIButton` and the React `<Button>` forward a `bitmap` boolean to their auto-wrapped string label (no effect when the child is a composed element). `UIButton.update()` refreshes the cached `bitmap` flag and `textStyle` before promoting a not-yet-created label (so a `bitmap`/`textStyle`-before-`children` two-step reconcile builds the label with the right class and style), and warns when a `bitmap` change can't apply to an existing label, mirroring `UIText`.
  - `UIPlugin` now captures and restores the UI default text-style singleton on destroy (like `RendererPlugin`), so the default no longer leaks across engine lifecycles.
  - Bitmap text no longer loses its font on re-render / recolour ([#86](https://github.com/marco-lepore/yage/issues/86)): the font now lives in `style.fontFamily` (a normal style property carried on every re-apply), and `mergeStyle` preserves it on an imperative recolour — superseding the construction-time `bitmap.font → fontFamily` fold.
  - `installBitmapFont` bakes glyphs **white** by default ([#87](https://github.com/marco-lepore/yage/issues/87)) instead of Pixi's black `TextStyle` default, so a per-text `fill` / `tint` (a multiply over the atlas) recolours them out of the box — `black × tint = black` otherwise. An explicit `style.fill` still wins.

### Patch Changes

- [#103](https://github.com/marco-lepore/yage/pull/103) [`face78b`](https://github.com/marco-lepore/yage/commit/face78ba63f9ef6eb52d8a677fc1d8b1457212e6) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Fix a one-frame flash of the outgoing scene at the end of a `pop`/`replace` transition.
  - Tear the outgoing scene down inside the transition's finalize step so the stack is in its post-mutation shape before `scene:transition:ended` is emitted. End-of-transition listeners (e.g. the renderer's visibility recompute) now see the settled stack instead of the stale pre-teardown one.
  - For a transitioned `pop`/`replace`, the stack-mutation event (`scene:popped` / `scene:replaced`) now fires just before `scene:transition:ended` rather than just after. `isTransitioning` is still `true` when it fires.

- [#95](https://github.com/marco-lepore/yage/pull/95) [`4627c80`](https://github.com/marco-lepore/yage/commit/4627c80e409226ff58c2214c2e1bb76e9e1d769f) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `Scene.service()` and the new `Scene.use()` are now scope-aware, so a scene can resolve its own scene-scoped services (e.g. `SceneRenderTreeKey`, `PhysicsWorldKey`) directly.
  - Added `Scene.use(key)`, mirroring `Component.use`: scene scope is checked first, then engine scope. Previously `Scene.service()` resolved only against the engine context, so scene-scoped keys were unreachable from `onEnter` and game code had to fall back to the near-identical provider key.
  - A scene-scoped key that resolves only at engine scope now logs a warning (likely a plugin missing its `beforeEnter` registration), and an unresolved scene-scoped key throws a named, actionable error instead of failing opaquely.
  - `Scene.service()` delegates to `use()` for lazy field-initializer resolution. Note the proxy caches its first resolved value: prefer `use()` inside `onEnter()` for scene-scoped keys, since a cached value would go stale across scene exit/re-entry.

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
