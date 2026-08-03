# @yagejs/renderer

## 0.10.1

### Patch Changes

- Updated dependencies [[`d3a730b`](https://github.com/marco-lepore/yage/commit/d3a730b1dfae45338a53ddcc1267ae3e4102a34a), [`ccc0d71`](https://github.com/marco-lepore/yage/commit/ccc0d71c7f1ae4197b56a5469f61ae4145045391), [`50cc882`](https://github.com/marco-lepore/yage/commit/50cc8825c4365165a5ebfafbb6353c26660daa23)]:
  - @yagejs/core@0.10.1

## 0.10.0

### Minor Changes

- [#213](https://github.com/marco-lepore/yage/pull/213) [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add whole-block anchoring to `SplitTextComponent` and a common `EffectHandle.setIntensity()` method.

  Development builds now also warn when the page loads multiple copies of `@yagejs/renderer`.

- [#214](https://github.com/marco-lepore/yage/pull/214) [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Entities can now be turned off and reused instead of destroyed and respawned: `entity.setActive(false)` puts an entity and its whole subtree to sleep, and components get `onEnable` / `onDisable` to release and reacquire live resources.
  - The five visual components hide their display object while the entity is dormant and show it again on reactivation.
  - `visible` now stores what you set and reads it back unchanged; the Pixi flag is that value combined with the component being effectively enabled. Hiding a sprite by hand survives a deactivate/reactivate cycle, and a snapshot taken while the entity is dormant records your value rather than `false`.
  - Setting `component.enabled = false` hides the display object instead of leaving it painted in place.

- [#218](https://github.com/marco-lepore/yage/pull/218) [`81eafe0`](https://github.com/marco-lepore/yage/commit/81eafe04c3b362832e2dc873bea996f36f4601fd) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Offscreen render targets and a `blendMode` option on every visual component — the two pieces needed to composite objects against each other before they reach the screen.
  - **`renderer.createRenderTarget(source, options)`** draws a container into a texture your game owns and redraws on a schedule you control: `invalidate()` marks it stale, `renderIfNeeded()` draws only when something changed, `render()` forces a draw. `resolutionScale` trades texels for cost, so a half-scale light or blur buffer is a one-line change. It is the repeatable counterpart of `createTexture`, which bakes a texture once. Content is drawn in the source container's own coordinate space — the camera and the responsive `fit` transform do not reach it, so a buffer that must follow the camera positions its own children through `camera.worldToScreen()`.
  - **`blendMode`** on `SpriteComponent`, `AnimatedSpriteComponent`, `GraphicsComponent`, `TextComponent`, and `SplitTextComponent`, as both a constructor option and a live accessor. It is typed as `BlendMode` from `@yagejs/renderer`, so reaching the raw Pixi display object for the mode union is no longer necessary. Pixi constructs display objects at `"inherit"` rather than `"normal"`, and the two differ under a non-normal parent, so `serialize()` omits the field only when it is `"inherit"` and an explicit `"normal"` survives a round trip. The photoshop-style modes (`"darken"`, `"overlay"`, `"color-dodge"`, ...) need `import "pixi.js/advanced-blend-modes"` in the game's entry file; the GPU-native ones, `"erase"` included, need nothing.

  `"erase"` composites against whatever framebuffer it is drawn into, so cutting a hole in one object rather than the whole scene means drawing both into a render target. Blend behaviour inside a render target is verified on the WebGL backend and unmeasured on WebGPU.

### Patch Changes

- [#204](https://github.com/marco-lepore/yage/pull/204) [`8400b55`](https://github.com/marco-lepore/yage/commit/8400b5519cb3401a0ad91ab1be511e3d885cc203) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Correct JSDoc code examples so editor tooltips and the generated API reference match the shipped API. `@yagejs/renderer`: camera `shake`/`zoomTo` example durations are in seconds, and `defaultTextStyle` no longer lists `resolution` (it is a `TextComponent` constructor option, not a style property). `@yagejs/ui-react`: the `SplitText` reveal examples use `Tween.custom` setters instead of `Tween.to`, which only accepts a plain `Record<string, number>`.

- Updated dependencies [[`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`f1048ab`](https://github.com/marco-lepore/yage/commit/f1048ab756feee84e593609521c3a58fcfc1c1a7), [`4a5b3b6`](https://github.com/marco-lepore/yage/commit/4a5b3b639ddcbb285b6a4733b89d27bcee14c50c), [`d459026`](https://github.com/marco-lepore/yage/commit/d4590265b9aa5297fb99d20b92bb5a2f19cac0c5)]:
  - @yagejs/core@0.10.0

## 0.9.0

### Minor Changes

- [#188](https://github.com/marco-lepore/yage/pull/188) [`c62453b`](https://github.com/marco-lepore/yage/commit/c62453b48a5f5dbebdb26c6bab495cc7d5b64195) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Make animated sprite playback follow scene and entity time scaling.

  `AnimatedSpriteComponent` animations freeze while their scene is paused, while
  `scene.timeScale` is `0`, or while the component is disabled. Other scene and
  entity time-scale values compose with Pixi's `animationSpeed`.

- [#196](https://github.com/marco-lepore/yage/pull/196) [`22c05c8`](https://github.com/marco-lepore/yage/commit/22c05c8a561d6361ca3489eaa2d0a0ea5caf2492) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Explicit programmatic-texture path: runtime-created textures now register under asset keys.
  - New `registerTexture(key, texture)` / `unregisterTexture(key)`: put a runtime-created texture (e.g. from `RendererPlugin.createTexture`) into the global asset cache under a key, so every key-based surface resolves it like a preloaded asset — `SpriteComponent`'s `texture`, `FrameSource.sheet` strips, and particles' `textureKey`. Registering over a loaded asset's key throws; unregistering never destroys the texture (the creator owns it).
  - New `TextureRef` type (`string | TextureHandle`) — the serializable texture reference serialized components accept.
  - Breaking: `SpriteComponentOptions.texture` and `setTexture()` narrow from `TextureInput` to `TextureRef` — raw `Texture` objects are no longer accepted. `serialize()` always returns full `SpriteData` (the null-with-console.warn path is gone) and `SpriteData.textureKey` is non-null. Reference runtime textures by registered key instead.
  - Breaking: resolving a texture key that is neither preloaded nor registered now throws an error naming the key (`resolveTextureInput`, `sliceSheet`, and every component built on them) instead of producing an empty texture or an obscure downstream `TypeError`.

- [#159](https://github.com/marco-lepore/yage/pull/159) [`9b637bc`](https://github.com/marco-lepore/yage/commit/9b637bcd832476a6c47eb4dacb8cf33e9c5139b0) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Change the engine time unit from milliseconds to seconds.

  `Component.update(dt)` / `fixedUpdate(dt)` now receive seconds (~0.0167 at 60fps) instead of milliseconds. `EngineConfig.fixedTimestep` defaults to `1/60` and is expressed in seconds. All duration-based APIs follow: `Process.delay`, `ProcessSlot`/`ProcessComponent.slot` durations, `Tween`/`Sequence.wait`/`Tween.stagger` step, `KeyframeTrack` keyframe `time`, `LoadingScene.minDuration`, scene-transition durations (`fade`/`flash`/`crossFade`/`iris`/`irisReveal`/`chessboard`/`slidePush`), `CameraComponent.shake`/`zoomTo`, `AnimationController.playOneShot`, and effect durations/fades (`hitFlash`, `shockwave`, `fadeIn`/`fadeOut`) are all in seconds.

  Migration: drop any `dt / 1000` conversion in your `update`/`fixedUpdate` code, and pass durations in seconds (e.g. `300` ms becomes `0.3`).

- [#190](https://github.com/marco-lepore/yage/pull/190) [`3fbbe3d`](https://github.com/marco-lepore/yage/commit/3fbbe3d3c936f636d5069e296a4ca228b7511c86) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `FrameSource` sheet slicing covers multi-row grid sheets: the sheet variant (renamed `SheetFrameSource`, with `isSheetSource`; previously `StripFrameSource`/`isStripSource`) gains the full uniform-grid options (`count`, `columns`, `startX`, `startY`, `gapX`, `gapY`), so `AnimatedSpriteComponent` and `AnimationController` can address any frame grid serializably — a plain `{ sheet, frameWidth }` still reads the single top row. The shared slicer is exported as `sliceGrid(texture, options)`; `sliceSheet` and `sliceTextureFrames` delegate to it unchanged.

- [#158](https://github.com/marco-lepore/yage/pull/158) [`0735a9a`](https://github.com/marco-lepore/yage/commit/0735a9a3a1fa6e3f7b8549887b9b87d43674df98) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Warn and fall back to the default layer when a renderable targets an undeclared layer.
  - A visual component (`SpriteComponent`, `GraphicsComponent`, `AnimatedSpriteComponent`, `TextComponent`, `SplitTextComponent`, or a custom `LayerRenderable`) whose `layer` names a layer the scene never declared now emits a dev-mode `[yage]` warning — naming the entity, the missing layer, and the scene — and renders into the `"default"` layer, instead of failing with an opaque `RenderLayer not found` error and a silently missing sprite. The warning is tree-shaken from production builds.
  - Clarified that `RendererAdapter.hitTestUI` only detects surfaces marked via `markPointerConsumeContainer` (`@yagejs/ui` primitives and `Sprite` / `AnimatedSprite` components), not raw-Pixi UI such as the dialogue addon's box; dialogue-aware callers should gate on `DialogueController.isActive()` / `isChoosing()`.

- [#178](https://github.com/marco-lepore/yage/pull/178) [`82db867`](https://github.com/marco-lepore/yage/commit/82db867c0176208d5968ae3aa68296db3d724955) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Unify the five visual components' options, delete the raw-texture escape
  hatches, and stop leaking raw `pixi.js` types from public signatures.
  - `SpriteComponent`, `AnimatedSpriteComponent`, `GraphicsComponent`,
    `TextComponent`, and `SplitTextComponent` all accept the same
    `visible?`, `tint?: ColorValue`, `alpha?: number`, and
    `interactive?: { eventMode?, consumeOnInteraction? }` options, with
    matching `visible`/`tint`/`alpha` runtime accessors — `GraphicsComponent`
    previously had none of these, and `SplitTextComponent` previously had no
    effects/mask support (`fx`, `setMask`, `clearMask`) at all; both now
    match the other three.
  - **Breaking:** `AnimatedSpriteComponentOptions.textures` and
    `AnimationDef.frames` are removed — `source` (a `FrameSource`) is now
    required on both `AnimatedSpriteComponent` and `AnimationController`, so
    every controller/sprite is always fully serializable (no more
    `serialize(): null` + warn path for raw frames). The AnimatedSprite
    tuple anchor form (`[x, y]`) is also removed — use `{ x, y }`.
  - **Breaking:** `RendererConfig.pixi` is now `Partial<ApplicationOptions>`
    instead of `Record<string, unknown>` — a misspelled Pixi Application
    option now fails typecheck instead of being silently dropped.
  - **Breaking:** no exported field, parameter, or return type in
    `@yagejs/renderer` uses a raw `pixi.js` type anymore — every one goes
    through this package's own alias layer (`DisplayContainer`,
    `DisplaySprite`, `DisplayAnimatedSprite`, `DisplaySplitText`,
    `DisplaySplitBitmapText`, `GraphicsContext`, `NineSliceSprite`, `Filter`,
    `ParticleContainer`, `Application`, `ApplicationOptions`, ...). The
    aliases are transparent type equalities, so this is type-only — no
    runtime behavior changes, and every escape hatch (`.sprite`, `.graphics`,
    `RendererPlugin.application`, ...) still returns the real Pixi object.

### Patch Changes

- [#182](https://github.com/marco-lepore/yage/pull/182) [`a5c8be9`](https://github.com/marco-lepore/yage/commit/a5c8be9527ce31a5a8f0ce6b6d94a830d2322c83) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Close the raw `pixi.js` type positions that survived the type-alias sweep.
  - New `DestroyOptions` alias in the public type vocabulary (exported from
    the barrel) — the visual components' protected `destroyOptions()` hook no
    longer names a raw `pixi.js` type in the public `.d.ts`.

- [#192](https://github.com/marco-lepore/yage/pull/192) [`f6c2fa8`](https://github.com/marco-lepore/yage/commit/f6c2fa8e508620fb5356b8e4481a199115a73a45) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Snapshot restore order is now driven by a `restorePriority` static on each component class.
  - `VisualComponent` declares priority 30 (inherited by all visual components) and `AnimationController` declares 40, so on restore the animated sprite exists before the controller's `onAdd()` drives it.

- Updated dependencies [[`0574e44`](https://github.com/marco-lepore/yage/commit/0574e44d68df2568c57d0275aff139bddebb06da), [`3f7a367`](https://github.com/marco-lepore/yage/commit/3f7a367edc5af8d0d78e6e95bcc709bd8b77d783), [`a5d7d53`](https://github.com/marco-lepore/yage/commit/a5d7d5370fb8db567f4ceb39934574ab5c37a174), [`22f8534`](https://github.com/marco-lepore/yage/commit/22f8534e8dbc9ef054c23a570ab851f8710db68f), [`da97f10`](https://github.com/marco-lepore/yage/commit/da97f10ba7cb7627f48efccf3bfe1836bfac3dbc), [`f6c2fa8`](https://github.com/marco-lepore/yage/commit/f6c2fa8e508620fb5356b8e4481a199115a73a45), [`10d3ac5`](https://github.com/marco-lepore/yage/commit/10d3ac5ec3f3dca593f35728b175df3bfd073bb6), [`8a933db`](https://github.com/marco-lepore/yage/commit/8a933db95eedb908ad98e95631d5022fe1e0ef28), [`9b637bc`](https://github.com/marco-lepore/yage/commit/9b637bcd832476a6c47eb4dacb8cf33e9c5139b0), [`9b02d02`](https://github.com/marco-lepore/yage/commit/9b02d024fe54ea30efef01a109387b839266b791), [`8156b6d`](https://github.com/marco-lepore/yage/commit/8156b6dcc8429b738c3efeb949fafd1cce245330), [`8d061c5`](https://github.com/marco-lepore/yage/commit/8d061c54eb0bbf3aed75b2b943fef1affdce7667)]:
  - @yagejs/core@0.9.0

## 0.8.0

### Minor Changes

- [#121](https://github.com/marco-lepore/yage/pull/121) [`62da81f`](https://github.com/marco-lepore/yage/commit/62da81f67076fccaff3a8af6c805dd919c6a687f) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Reference-count shared assets so a font or texture held by more than one owner survives until the last release.
  - Add `uninstallBitmapFont(name)`, the symmetric teardown for `installBitmapFont` — it frees the baked atlas (and every emphasis variant) plus the source face. Previously an install-once bitmap font had no teardown and leaked until the page unloaded.
  - Baked bitmap fonts are now reference-counted by family name, so a family shared by an `installBitmapFont` and a `webFont({ bitmap })` (or by two web-font loads) is `BitmapFont.uninstall`ed only once the last owner releases it. Unloading one `webFont` no longer wipes the atlas and variant registry out from under another consumer (review follow-up to [#116](https://github.com/marco-lepore/yage/issues/116)).

- [#119](https://github.com/marco-lepore/yage/pull/119) [`cc29414`](https://github.com/marco-lepore/yage/commit/cc29414877a074688a411d93f7ecf6781ca82ea2) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add synthetic bold/italic for bitmap fonts via `installBitmapFont({ variants })`.

  `installBitmapFont` now accepts a `variants` array (`BitmapFontVariant[]`) that bakes weight/style emphasis atlases from the same source `.ttf` alongside the base font. A `BitmapText` whose `style.fontWeight` / `fontStyle` asks for bold or italic then renders from the matching atlas automatically — previously those props were honoured only by canvas `Text` and silently ignored by `BitmapText`.

  All baked variants are baseline-aligned to the base atlas (`baseLineOffset` + `lineHeight` normalized at bake time), so a bold span and regular text sit on one shared baseline with no vertical drift when mixed on a line.

- [#106](https://github.com/marco-lepore/yage/pull/106) [`2982d21`](https://github.com/marco-lepore/yage/commit/2982d21facc865261e258ee02dc6b8000f226e9f) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Let the auto-created `"default"` render layer be configured and sorted.
  - Declaring a `LayerDef` named `"default"` now configures the pre-created order-0 layer (its `sort`, `space`, `isRenderGroup`) instead of being silently ignored — so `{ name: "default", sort: ySort }` depth-sorts the layer entities already render on, with no per-component `layer` wiring. The declared `order` is still pinned to 0.
  - Added `RenderLayer.setSort(fn)` to opt a layer into (or out of) a depth-key at runtime; it flips `container.sortableChildren` to match. Pass `undefined` to revert to insertion order.

- [#114](https://github.com/marco-lepore/yage/pull/114) [`555a868`](https://github.com/marco-lepore/yage/commit/555a86888ec3aedca42587fab7eb3ec5f0c6eeb8) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add a derived rendered-geometry / visibility facet to the Inspector snapshot, wired through a generic facet-contributor seam so `@yagejs/core` stays renderer-agnostic.
  - `@yagejs/core`: the Inspector gains a generic facet seam — `registerFacetContributor()` lets a plugin attach a namespaced facet (`InspectorFacetContributor`) to component and entity snapshots, surfaced under an open `facets?: InspectorFacets` map on `WorldEntitySnapshot` and `ComponentStateSnapshot`. Core knows nothing about rendering: it just invokes each registered contributor per component (tolerating an absent or throwing hook), lets the contributor pick an entity-level facet, attaches results under their namespace, and keeps everything out of `serialize()`. This mirrors the contributor pattern already used by `DebugContributor` and save's `SnapshotContributor`. No Pixi or renderer concept leaks into core.
  - `@yagejs/renderer`: now owns the render facet end-to-end. Exports `RenderFacetSnapshot<Extra>` (moved out of core) and a `RenderFacetContributor` that `RendererPlugin` registers with the Inspector on install (removed on teardown). The contributor duck-types `inspectRender()` off each graphical component and surfaces the first painted component at the entity level. `SpriteComponent`, `AnimatedSpriteComponent`, `GraphicsComponent`, `TextComponent`, and `SplitTextComponent` expose `inspectRender()` — a compute-on-demand, read-only method deriving the live display object's world-space bounds and visibility from `getLocalBounds()` (leaving the scene graph's cached transforms untouched). `SplitTextComponent` additionally reports per-glyph visibility (`glyphs`) and the visible substring (`visibleText`), so a typewriter reveal is observable from the public Inspector API. Read the facet at `snapshot.entities[].facets?.render` / `component.facets?.render`; `bounds` are world-space pixels measured from the geometry itself (a sized-but-hidden object still reports its real box; `null` only for genuinely empty/zero-area geometry, with `visible` carrying the hidden/shown state).

- [#122](https://github.com/marco-lepore/yage/pull/122) [`664748f`](https://github.com/marco-lepore/yage/commit/664748fdf3c6a9527981746d0c5bd2528db4402d) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `measureWrappedText(text, options)` + `MeasureTextOptions` / `MeasuredText` — a wrap-aware text-metrics primitive that returns `{ width, height, lineCount }` without constructing a live text node. Reach for it to size a panel to its text (e.g. a content-sized dialogue bubble) instead of importing `pixi.js` directly — the same escape-hatch rationale as `createNineSlice`. Wrap-aware on both paths: canvas via `CanvasTextMetrics`, bitmap via `BitmapFontManager` with the atlas's base-unit metrics scaled to `fontSize` (matching what a `BitmapText` renders at). Measurement resolves the engine-level `defaultTextStyle` under the given options — the same merge the render path applies — and reuses one internal `TextStyle` so identical repeated measures can hit pixi's metrics cache.

- [#122](https://github.com/marco-lepore/yage/pull/122) [`664748f`](https://github.com/marco-lepore/yage/commit/664748fdf3c6a9527981746d0c5bd2528db4402d) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add a nine-slice primitive: `createNineSlice(options)` + `NineSliceOptions`, and re-export the `NineSliceSprite` type. Resolves a `TextureInput` and returns a configured stretchable frame whose corners stay crisp at any size — the same raw-display-object escape hatch as `resolveTexture`. Lets addons and games build textured panels/frames/buttons through `@yagejs/renderer` instead of importing `pixi.js` directly.

- [#120](https://github.com/marco-lepore/yage/pull/120) [`cafa74c`](https://github.com/marco-lepore/yage/commit/cafa74cbe90ec1143c60dcfd782a0a76c8d859dd) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `SortGroupComponent` — render a multi-part entity as one depth unit under a layer sort.
  - Under a layer `sort` (e.g. `ySort`) every visual is keyed independently, so a multi-part entity — a body plus offset child sprites, or a parent plus child entities — splits when an unrelated entity's depth key lands between its parts. `SortGroupComponent` gives the entity its own stacking context: its visuals sort among themselves inside an owned sub-container while the group sorts as a single unit against the rest of the layer (the same idea as Unity's `SortingGroup`).
  - The group sorts at the owning entity's own sprite (so `ySort` / `ySortBy` read a real position and offset), falling back to its `Transform` position when the entity renders nothing itself. Members keep insertion order and honour a manually-set `zIndex` by default; pass `innerSort` to depth-sort members among themselves. Only paint order changes — positions, rotation, and scale stay composed by the ECS `Transform`.
  - Added a `renderObject` getter to `SpriteComponent`, `GraphicsComponent`, `AnimatedSpriteComponent`, `TextComponent`, and `SplitTextComponent` for uniform access to the underlying Pixi display object.

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

- [#116](https://github.com/marco-lepore/yage/pull/116) [`68e7243`](https://github.com/marco-lepore/yage/commit/68e72436209f7e03f0e8ad0bde94f3d23562bcbe) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add a declarative `bitmap` option to `webFont` so one declared font is usable as both canvas `Text` and `BitmapText` under a single family. Pass `bitmap: true` (or a `WebFontBakeOptions` object — `{ size?, chars?, resolution?, padding?, style?, variants? }`) to bake a glyph atlas from the loaded face during `preload`; the canvas face and baked atlas share the font's `family` across Pixi's separate registries. Unloading the web font uninstalls every baked atlas alongside the canvas face. Closes [#101](https://github.com/marco-lepore/yage/issues/101).

### Patch Changes

- Updated dependencies [[`62da81f`](https://github.com/marco-lepore/yage/commit/62da81f67076fccaff3a8af6c805dd919c6a687f), [`8e2ab0b`](https://github.com/marco-lepore/yage/commit/8e2ab0b301748c2ac5f3d90224d3a2cc92393865), [`face78b`](https://github.com/marco-lepore/yage/commit/face78ba63f9ef6eb52d8a677fc1d8b1457212e6), [`555a868`](https://github.com/marco-lepore/yage/commit/555a86888ec3aedca42587fab7eb3ec5f0c6eeb8), [`4627c80`](https://github.com/marco-lepore/yage/commit/4627c80e409226ff58c2214c2e1bb76e9e1d769f), [`3991288`](https://github.com/marco-lepore/yage/commit/39912883cf191cd065ef0b5779f1b65b53bcbea8), [`23e357f`](https://github.com/marco-lepore/yage/commit/23e357f605957cc24e58ec2e504a82d4ebdcc9a0)]:
  - @yagejs/core@0.8.0

## 0.7.0

### Minor Changes

- [#67](https://github.com/marco-lepore/yage/pull/67) [`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `AnimatedSpriteComponent` now accepts `anchor` and `tint` options.

  `AnimatedSpriteComponentOptions` gained:
  - `anchor?: Vec2Like | readonly [number, number]` — component-level default anchor, applied during setup. Per-`AnimationDef.anchor` overrides this when set.
  - `tint?: number | string` — forwarded to `AnimatedSprite.tint` (Pixi v8 accepts both numeric colors and color strings).

  Both options are now persisted: `AnimatedSpriteData` gained optional `anchor` and `tint` fields and `serialize()` / `fromSnapshot()` round-trip them — matching `SpriteComponent` / `SpriteData` so save/load doesn't silently revert the component to defaults.

  Brings `AnimatedSpriteComponent` to parity with the equivalent setters on `SpriteComponent` so swapping between the two needs no extra boilerplate.

- [#77](https://github.com/marco-lepore/yage/pull/77) [`8d80f18`](https://github.com/marco-lepore/yage/commit/8d80f1856ac897e8dcaa28543d57ff16750e97f3) Thanks [@marco-lepore](https://github.com/marco-lepore)! - BitmapText path for pixel-art text + per-text `resolution`.
  - `TextComponent` and `UIText` accept a new `bitmap?: boolean | { font?: string; size?: number }` option. `true` bakes a dynamic bitmap font from the text's own `style`; the object form renders with an installed/loaded font by name (`size` overrides the glyph size). Canvas-rasterised Pixi `Text` is bilinear-sampled and goes blurry at non-integer scale on non-Retina displays — `BitmapText` draws crisp pre-baked glyph quads instead. Yoga measurement (the PR [#67](https://github.com/marco-lepore/yage/issues/67) word-wrap / `truncate` semantics) is unchanged on the bitmap path.
  - New `bitmapFont(path)` asset factory (wired into the renderer asset pipeline as the `"bitmap-font"` loader) for BMFont `.fnt`/`.xml` + atlas descriptors, plus an async `installBitmapFont(source, opts)` helper that loads a `.ttf` and bakes a glyph atlas via Pixi v8's `BitmapFont.install`, returning the registered font name.
  - New `resolution?: number` constructor option on `TextComponent` / `UIText` (and the React `<Text>` wrapper). Pixi v8 `resolution` is a `Text` constructor option, NOT a `TextStyle` property — this is the only way to get crisp canvas text without a prototype patch. Ignored when `bitmap` is set (bitmap resolution is fixed at font-bake time).
  - `TextComponent` serialization round-trips `bitmap` and `resolution`. `@yagejs/ui-react`'s `TextProps` gains the same two props.
  - `bitmap` / `resolution` are construction-only — Pixi v8 can't morph `Text`↔`BitmapText` or change `resolution` in place. `UIText.update()` (the React reconciler path) emits a dev-mode warning when either changes instead of silently dropping it; remount the element (e.g. change its React `key`) to switch.

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

- [#71](https://github.com/marco-lepore/yage/pull/71) [`0e9f86c`](https://github.com/marco-lepore/yage/commit/0e9f86cc42bb632d38a67c22aa31b6dd21cf82e7) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Renderer ergonomics: `RendererConfig.pixelArtPreset`, `CameraEntity.fitTo`, and `LayerDef.sort` + `ySort` / `ySortBy` helpers.
  - **`RendererConfig.pixelArtPreset?: boolean`** (default `false`). One flag flips `TextureStyle.defaultOptions.scaleMode = "nearest"`, `roundPixels: true` on the Pixi `Application`, and `image-rendering: pixelated` (with a `-webkit-optimize-contrast` Safari fallback) on the canvas element. Composes with `pixi: {...}` — explicit user overrides win. The `TextureStyle` global is captured on install and restored on destroy so the mutation stays scoped to the plugin's lifetime.
  - **`CameraEntityParams.fitTo?: { x; y; width; height }`**. Frames an axis-aligned world rectangle by setting both `position` (the rect's centre) and `zoom` (`contain` semantics — `min(viewportW / rect.w, viewportH / rect.h)`) at setup. Overrides explicit `position` / `zoom` when supplied. The right primitive for fixed-camera scenes (puzzle boards, arcade levels, dialog-scene insets) where the framed area is known up front and zoom matters as much as position.
  - **`LayerDef.sort?: (c: Container) => number`**. Per-frame **depth-key** function. `DisplaySystem` writes `child.zIndex = sort(child)` on every direct child of the layer, and the layer container's `sortableChildren` is flipped to `true` so Pixi's render pipeline orders by zIndex. Layers without a `sort` keep insertion order. Composes with manual `child.zIndex` writes — a depth-key fn handles the bulk; individual sprites can still write their own zIndex between frames for one-off bias.
  - **`ySort` / `ySortBy`** exported from `@yagejs/renderer`. `ySort` is `(c) => c.position.y` for the classic top-down 2D depth rule; `ySortBy(offsetOf)` adds a per-container offset to the depth key (Godot's `y_sort_origin` pattern) so anchored-at-top sprites can advertise their visual "footprint".
  - **Removed** `LayerDef.sortableChildren` — subsumed by `sort` (which enables auto-sort internally). Game code that wants Pixi's pure zIndex auto-sort without a depth-key fn can write `tree.get(name).container.sortableChildren = true` directly; the redundant declarative field is gone.

### Patch Changes

- [#67](https://github.com/marco-lepore/yage/pull/67) [`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Fix Pixi v8 deprecation warning in the `iris()` scene transition.

  `iris()` was constructing `new Graphics()` and adding the mask geometry as a child — Pixi v8 logs a deprecation because `Graphics` is no longer a `Container`. The overlay is now a real `Container` that holds the color fill `Graphics` plus the mask `Graphics`, so the warning goes away while the transition renders identically.

- Updated dependencies [[`069d41e`](https://github.com/marco-lepore/yage/commit/069d41e711aeb6218c1438f52a2b098ff8946526), [`90e4d30`](https://github.com/marco-lepore/yage/commit/90e4d3064d9c2804549d62844067cf487d592f0a), [`57a6441`](https://github.com/marco-lepore/yage/commit/57a6441f9ef8b5f7140959d6393930c2326d70e0), [`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40), [`7ca5050`](https://github.com/marco-lepore/yage/commit/7ca5050d91479121039af5e4898fc0c220e8d7c3)]:
  - @yagejs/core@0.7.0

## 0.6.0

### Minor Changes

- [#59](https://github.com/marco-lepore/yage/pull/59) [`9a2519b`](https://github.com/marco-lepore/yage/commit/9a2519ba9ed739cacc116699fc2944eb54930e23) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Move the responsive `fit` transform off `app.stage` and onto a dedicated `_worldRoot` container that sits between stage and per-scene roots. Stage stays at identity; the world root carries scale/offset.

  Why: Pixi v8 feeds the active render group's transform to shaders via `uWorldTransformMatrix`. `@pixi/tilemap`'s pipe composes `uProjection × uWorldTransformMatrix × tilemap.worldTransform`, but `tilemap.worldTransform` is already cumulative from root — so any non-identity transform on the active render group is applied twice, silently mis-scaling tile rendering relative to Sprites/Graphics (whose batched renderer pre-transforms vertices on CPU and doesn't read `uWorldTransformMatrix`). The bug only manifested at fit ratios ≠ 1 with non-trivial camera zoom, which is why it stayed hidden on desktop and surfaced as a tile/object misalignment on mobile.

  Putting the fit transform on a regular Container child of stage keeps `uWorldTransformMatrix = identity` at render time, so `@pixi/tilemap`'s pipe — and any other shader that reads `uWorldTransformMatrix` — composes correctly. Stage-direct children (transition overlays, the screen-scope `RendererPlugin.fx` host) keep their canvas-pixel coordinates as before.

  User-visible surface is unchanged for `canvasToVirtual`, scene render trees, and the `Fit` controller's outputs. The only structural change is one extra container in the tree (`stage → _worldRoot → scene roots`).

  Also fixes a pre-existing bug in `hitTestUI`: the method is documented to take virtual coordinates (matching how the input plugin stores pointer positions) but was forwarding them straight through to `EventBoundary.hitTest`, which expects canvas-relative coordinates per the Pixi v8 spec. At fit ratio 1 the two coincide so the bug stayed hidden on desktop; at any other ratio (mobile / responsive) UI auto-consume silently missed every surface. The method now converts via `FitController.virtualToCanvas` before calling `boundary.hitTest`.

- [#61](https://github.com/marco-lepore/yage/pull/61) [`cd26383`](https://github.com/marco-lepore/yage/commit/cd2638345e54709a2a5281334dc71448de64f4cf) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add four scene transitions: `iris` (close-then-open dip-to-color, retro Zelda style), `irisReveal` (one-way circular reveal of the destination), `chessboard` (staggered cell-by-cell mask reveal), and `slidePush` (incoming and outgoing scenes translate in lockstep). All four size their masks/translations against `renderer.virtualSize` so they line up correctly with the scene root under any responsive-fit ratio. `IrisOptions.center` and `IrisRevealOptions.center` are documented as virtual-space pixels.

  Also adds `getVirtualBounds(ctx)` as a transition-author helper alongside `getSceneContainer`. Returns `{ width, height }` of the coordinate space scene roots and `app.stage` operate in — the right thing to size fullscreen overlays / masks / slide distances against. Reaching for `app.screen` (canvas pixels) on stage children is a footgun that surfaces only on non-1.0 fit ratios; the transition guides now flag it explicitly.

- [#62](https://github.com/marco-lepore/yage/pull/62) [`d9be1b3`](https://github.com/marco-lepore/yage/commit/d9be1b365ae83a8ca365d72003ec23e6fbb8679f) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Re-home `fade`, `flash`, and `iris` overlays under the world-root architecture introduced in [#59](https://github.com/marco-lepore/yage/issues/59) (which moved the fit transform off `app.stage` onto a dedicated `_worldRoot`). All three now parent to `renderer.worldRoot` by default and size against `renderer.visibleCanvasRect` (the canvas extent in virtual pixels). Net effect:
  - **letterbox** — overlay covers the virtual rect; bars stay visible (the worldRoot mask clips overshoot).
  - **expand** — overlay paints into the bars too (no clipping mask under expand), matching the model where `expand` games treat the bar area as part of the play surface.
  - **cover / stretch** — overlay covers what's on screen.

  Adds an opt-in `coverScreen?: boolean` to `FadeOptions`, `FlashOptions`, and `IrisOptions` that re-parents the overlay to `app.stage` and sizes against `app.screen.width / .height` — covers the canvas including letterbox bars, for the rare case where the host-page background showing through is jarring.

  `IrisOptions.center` and `IrisRevealOptions.center` are now both consistently in **virtual pixels** (game coordinates). When `coverScreen: true`, the iris center is converted internally via `renderer.virtualToCanvas`.

  Also exposes `RendererPlugin.worldRoot: Container` as a public getter so custom transition authors can parent virtual-space overlays without resolving private internals.

  The scene-root transitions (`chessboard`, `irisReveal`, `slidePush`) are unchanged — they manipulate scene roots directly and have always operated correctly in virtual pixels.

### Patch Changes

- [#61](https://github.com/marco-lepore/yage/pull/61) [`cd26383`](https://github.com/marco-lepore/yage/commit/cd2638345e54709a2a5281334dc71448de64f4cf) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Fix `fade` and `flash` overlay sizing under responsive fit. The full-screen rect was sized from `app.screen` (canvas pixels) but parented to `app.stage`, which carries the fit transform — so on devices where the virtual size differs from the canvas size (mobile letterbox, any non-1.0 fit ratio) the overlay covered only a fraction of the viewport. Now sized from `renderer.virtualSize` like the other transitions.

- [#64](https://github.com/marco-lepore/yage/pull/64) [`47ffab6`](https://github.com/marco-lepore/yage/commit/47ffab6b37423155f92e97519b66b73e14b73039) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Fix `FitController` resize feedback loop on hosts with a border or padding.
  - `FitController` now measures the host's content box (synchronous initial apply via `getBoundingClientRect()` minus computed padding/border, ResizeObserver via `contentBoxSize`) instead of the border-box. Sizing the canvas to the border-box on a host without an explicit height pushed the host's intrinsic block-size up by `2 × border` per apply, the observer re-fired, and the loop only stopped when the host hit a parent-driven cap like `max-height: 100%` — visible as the gradual Y-axis grow on initial mount and on viewport resize-up.

- [#55](https://github.com/marco-lepore/yage/pull/55) [`e4d8823`](https://github.com/marco-lepore/yage/commit/e4d882380e37a02c8fd259c5019c576a46f9aa89) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Typed reactive stores in core + a new Save IO instance built on them; snapshot system renamed to free the `Save*` namespace.
  - `RendererPlugin`'s optional snapshot bridge now resolves the renamed `SnapshotServiceKey` (peer-dep dynamic import), tracking the rename in `@yagejs/save`.

- Updated dependencies [[`1126143`](https://github.com/marco-lepore/yage/commit/11261436719fed28472cec3143281632f082add5), [`fe4aabc`](https://github.com/marco-lepore/yage/commit/fe4aabcf25525d078e584ab96e69dd907d96bc7c)]:
  - @yagejs/core@0.6.0

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

- [#52](https://github.com/marco-lepore/yage/pull/52) [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Input ergonomics: frame-deferred action edges, pointer/wheel consume primitives, listener parity, and UI auto-consume via the renderer's hit-test fallback.
  - `RendererPlugin` now implements the `hitTestUI(x, y)` extension on `RendererAdapter`. Walks Pixi's `EventBoundary.rootBoundary.hitTest` result up the parent chain and returns `true` when any ancestor was flagged via `markPointerConsumeContainer` (from `@yagejs/core`). `@yagejs/input` calls this on `pointerdown` drains to auto-claim presses landing on UI surfaces.
  - `SpriteComponent` and `AnimatedSpriteComponent` gain an optional `interactive?: { eventMode?, consumeOnInteraction? }` config. When `interactive` is set, the underlying Pixi sprite gets `eventMode: "static"` (or whatever was passed). When `consumeOnInteraction: true`, the sprite is also added to the consume registry — pointer presses landing on it auto-claim, so a tappable in-world sprite never double-fires gameplay actions like `MouseLeft`. Default `false` preserves the "I want both Pixi events AND the action map" use case.

### Patch Changes

- Updated dependencies [[`cf617fe`](https://github.com/marco-lepore/yage/commit/cf617fe0f28db6ea1a5af7992b76dc19eec8cd0c), [`bc3790d`](https://github.com/marco-lepore/yage/commit/bc3790dc4c31c42c4821cd275a9376a0830bb0db), [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b), [`114d246`](https://github.com/marco-lepore/yage/commit/114d246820a88e68841a4f9cec2167c188269970)]:
  - @yagejs/core@0.5.0

## 0.4.0

### Minor Changes

- [#44](https://github.com/marco-lepore/yage/pull/44) [`e7d6645`](https://github.com/marco-lepore/yage/commit/e7d6645f9acff27269fa6f6e52032482651b146d) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Effects preset package + handle-based save/load for effects and masks.
  - New `@yagejs/effects` package: ten hero presets — `hitFlash`, `bloom`, `outline`, `dropShadow`, `pixelate`, `glow`, `crt`, `chromaticAberration`, `vignette`, `colorGrade`. Each preset registers under a stable `yage:<name>` string via `defineEffect` so it survives save/load.
  - Renderer: new `defineEffect` / `defineMask` registries; `EffectStack.serialize` / `restoreFrom`; `MaskHandle.serialize`; `restoreMask` helper. The 4 visual components now persist their effects + mask through `serialize` / `afterRestore`. A `RendererSnapshotContributor` is auto-registered with `SaveService` (when present) to cover layer / scene / screen-scope effects + masks.
  - Save: new `SnapshotContributor` extension hook (`registerSnapshotExtra` / `unregisterSnapshotExtra`) so plugins can extend `GameSnapshot.extras`. Snapshot version bumped 3 → 4 — older saves no longer load.

  `rawFilter`, `spriteMask`, and `graphicsMask` skip serialization with a one-shot warning since they have no string identity to record. In-flight `fadeIn` / `fadeOut` tweens are not preserved across save/load.

- [#45](https://github.com/marco-lepore/yage/pull/45) [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Inspector deterministic test mode and per-package serialization plumbing for `Inspector.snapshot()`.
  - `CameraComponent`, `CameraFollow`, `CameraShake`, `CameraZoom`, `CameraBoundsComponent`, and `ScreenFollow` are now `@serializable`, with explicit `serialize()` / `static fromSnapshot(data)` pairs. Inspector world snapshots and save-system slots now capture full camera state (position, zoom, rotation, follow target by entity id, shake/zoom processes, bounds rect, parallax bindings).
  - New public types: `CameraComponentData`, `CameraFollowData`, `CameraShakeData`, `CameraZoomData`, `CameraBoundsComponentData`, `ScreenFollowData` (exported from the package barrel).

- [#39](https://github.com/marco-lepore/yage/pull/39) [`08efa94`](https://github.com/marco-lepore/yage/commit/08efa94a8be02ba56c1df9d3bed643abcc1d7159) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `TextComponent` and gradient fill helpers so user code no longer needs to import `Text` or `FillGradient` from `pixi.js`.
  - `TextComponent` — layer-aware, Transform-synced, serializable text, analogous to `SpriteComponent` / `GraphicsComponent`. Constructor takes `{ text, style?, anchor?, layer?, visible?, tint?, alpha? }`; `style` forwards to PixiJS `TextStyle` (CSS-like font properties). Use for world-space labels, floating damage numbers, and HUD text. Style options are cached on the component so `serialize()` emits a JSON-safe POJO rather than the live pixi `TextStyle` instance.
  - `linearGradient(...)` / `radialGradient(...)` — factory functions returning a `GradientFill` (pixi `FillGradient` under the hood) usable anywhere `g.fill(...)` accepts a fill style. Stops use yage-style numeric `color` + optional `alpha` per stop (no CSS color strings). Linear gradients support an `axis: "horizontal" | "vertical"` shorthand or explicit `start`/`end` points; radial gradients take `center`, `innerRadius`, `outerRadius`. Both default to `space: "local"` so a single instance scales across any shape it fills; pass `"global"` for absolute pixel coords.
  - New public type aliases: `DisplayText`, `GradientFill`. `public-types.ts` now uses top-level `import type` per AGENTS.md.
  - `examples/src/responsive-ui.ts` is rewritten — zero `pixi.js` imports remain. HUD cards now use `UIPanel` + `UIText` (`@yagejs/ui`) with `positioning: "transform"`, demonstrating the idiomatic split: laid-out text widgets are UI's job (flexbox padding, gap, background, child rows for free), while `TextComponent` and `GraphicsComponent` are the right primitives for free-positioned single-string text and procedural shapes respectively. The fog overlay uses the new `linearGradient` helper.

### Patch Changes

- Updated dependencies [[`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805)]:
  - @yagejs/core@0.4.0

## 0.3.0

### Minor Changes

- [#32](https://github.com/marco-lepore/yage/pull/32) [`c5e2656`](https://github.com/marco-lepore/yage/commit/c5e2656bd3dab4020a303e34dd77ccbd60ef4ca4) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `expand` fit mode plus canvas/visible geometry API.

  The existing `cover` uses CSS-cover semantics — it scales by `max` and crops the declared virtual rect on the long axis. For most games that's wrong: aspect ratio changes what the player can see. `expand` is the game-friendly alternative, matching Godot's `stretch/aspect=expand`, Unity's `Screen Match Mode=Expand`, and Construct 3's "Scale inner": virtual is always fully visible (same scale/offset as `letterbox`), but the leftover canvas space is the game's to draw into — fog, parallax, decorative backdrop, bar-anchored HUD — rather than painted with the background color.
  - `FitMode` adds `"expand"`. Geometry is identical to `letterbox`; the difference is rendering convention.
  - New `virtualCanvasRect: CanvasRect` — where the declared virtual rect sits on the canvas, in CSS pixels. Useful for DOM overlays positioned over the play area, cropping screenshots to gameplay, and mapping CSS-coord hit regions. `CanvasRect` is a new alias of `VirtualRect` so signatures signal which coordinate space a rect is in.
  - New `visibleCanvasRect: VirtualRect` — full canvas extent in virtual-space pixels, **not clamped** to the declared virtual rect. Under `letterbox`/`expand` on an off-aspect host it extends past virtual on the bar axis. Under `cover` it equals `visibleVirtualRect`; under `stretch` it equals the virtual rect. Iterate against it for backdrops that must fill the entire visible canvas, or anchor HUDs to the canvas corners instead of the play-area corners.
  - New `extendedVirtualRects: readonly VirtualRect[]` — the complement of `virtualRect` inside `visibleCanvasRect`: 0–2 strips of visible canvas that sit outside the virtual rect, in virtual-space pixels. Populated under `letterbox` and `expand` when aspect mismatches; empty under `cover` and `stretch`. Drives fog-over-bars under `expand` and also describes where the `backgroundColor` bars live under `letterbox` (useful for future bar customization).
  - New `virtualToCanvas(x, y): Vec2` forward transform, symmetric with the existing `canvasToVirtual`.
  - The `responsive-ui` example is rewritten against `expand`: grid extends across the full visible canvas, fog overlays the bars via `extendedVirtualRects`, and HUD corners anchor to `visibleCanvasRect` so cards land in the bars under off-aspect viewports. The fog/mask hack around `croppedVirtualRects` is gone.

  Non-breaking: `letterbox` / `cover` / `stretch` keep their existing semantics and geometry. Existing code that reads `visibleVirtualRect` or `croppedVirtualRects` keeps working unchanged.

- [#32](https://github.com/marco-lepore/yage/pull/32) [`c5e2656`](https://github.com/marco-lepore/yage/commit/c5e2656bd3dab4020a303e34dd77ccbd60ef4ca4) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Responsive canvas fit by default — the renderer now tracks its host element and re-maps the virtual rectangle on every resize.
  - `RendererConfig.fit` is an optional override taking `{ mode: "letterbox" | "cover" | "stretch"; target?: HTMLElement }`. When omitted, the renderer defaults to `{ mode: "letterbox" }` against the configured `container` (or `canvas.parentElement`). If neither resolves, the controller applies a one-shot transform against the initial `width × height` and installs no observer — opt in to full-page fit via `fit: { target: document.body }`. There is no "no-fit" code path anymore; fixed-size canvases are achieved by giving the container fixed CSS dimensions.
  - `letterbox` preserves aspect inside the host with bars in `backgroundColor`. `cover` preserves aspect and fills (overflowing on one axis). `stretch` applies non-uniform scale.
  - Runtime control on `RendererPlugin`: `setFit(options)` swaps modes/targets, the `fit` getter returns the current options, `canvasSize` returns the current CSS size.
  - New `canvasToVirtual(x, y)` inverts the current stage transform — CSS pixels relative to the canvas top-left → virtual-space pixels. Name chosen to avoid clashing with the engine's existing "screen space" terminology (which means virtual viewport space, not DOM pixels).
  - New `visibleVirtualRect` getter returns the on-screen sub-rect of virtual space (clamped to virtual bounds). Under `letterbox` / `stretch` it equals the full virtual rect; under `cover` it narrows on the long axis so HUDs can anchor to what players actually see while gameplay keeps using the full declared play area. `VirtualRect` is exported.
  - New `croppedVirtualRects` getter returns the complement: 0–2 strips of virtual space that are currently off-screen. Empty under `letterbox` / `stretch`; under `cover` returns the top+bottom or left+right crop strips. Lets effects reason about what's beyond the visible edge — fog-of-war overlays at the crop boundary, off-screen-activity indicators, auto-panning cameras.
  - Implementation uses `app.renderer.resize(hostW, hostH)` so hi-DPI stays correct via `resolution` + `autoDensity`, paired with a recomputed `stage.scale` / `stage.position` per mode.
  - Teardown is wired into `onDestroy`: the `ResizeObserver` is disconnected before `app.destroy()`. Headless environments (no DOM target, no `document`) fall back to a one-shot transform against the initial `width × height` and install no observer.

### Patch Changes

- [#36](https://github.com/marco-lepore/yage/pull/36) [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `RendererPlugin` now also registers itself under the new cross-package
  `RendererAdapterKey` (from `@yagejs/core`). This wires up `@yagejs/input`
  automatically — pointer events target the canvas and coordinates route
  through `canvasToVirtual` without any `rendererKey` config on `InputPlugin`.
  No behavior change for existing code that read `RendererKey` directly.
- Updated dependencies [[`69f8449`](https://github.com/marco-lepore/yage/commit/69f844942d1596228a6ed50a37ec8e6f1d821353), [`60d2067`](https://github.com/marco-lepore/yage/commit/60d20671e31230f5fcef127203efb127bdfedf92), [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb)]:
  - @yagejs/core@0.3.0

## 0.2.0

### Minor Changes

- [#30](https://github.com/marco-lepore/yage/pull/30) [`233aed2`](https://github.com/marco-lepore/yage/commit/233aed24dcd68e020a20a030d13668224ce22c4b) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Two additions for world-space UI and layer decoupling.

  **`ScreenFollow` component.** Each frame projects a world source through a camera and writes the resulting screen coord to this entity's `Transform.worldPosition`. The canonical billboard primitive: pair with `UIPanel` / `UIRoot` on a screen-space layer using `positioning: "transform"` to produce entity-anchored UI (nameplates, health bars, damage numbers) that tracks a target while staying axis-aligned and constant-size under any camera zoom or rotation. `target` accepts an `Entity`, a static `Vec2Like`, or a function returning a `Vec2Like` — for midpoints, animated paths, or arbitrary world sources. `offset` is in screen pixels, applied _after_ projection (`cam.worldToScreen(target) + offset`), so the visual gap between UI and target stays fixed under any camera zoom or rotation.

  **`CameraBinding` gains two new per-axis ratios** alongside the existing `translateRatio`: `rotateRatio` and `scaleRatio`. All three default to `1` (full camera effect), so existing parallax bindings are unchanged.
  - `rotateRatio: 0` — the bound layer stays upright regardless of camera rotation.
  - `scaleRatio: 0` — the bound layer stays at unit scale regardless of camera zoom.
  - Values in between blend linearly.

  These are **layer-level decoupling primitives** — useful for parallax, minimaps, and camera-agnostic world overlays. They are NOT the right answer for entity-anchored UI (use `ScreenFollow` + `positioning: "transform"` for that). The math in `DisplaySystem.applyCameraTransforms` reduces to the previous implementation exactly when all three ratios are `1`, so nothing changes for cameras that don't opt in.

- [#21](https://github.com/marco-lepore/yage/pull/21) [`32b35dc`](https://github.com/marco-lepore/yage/commit/32b35dcc89b5e28fdb852a08127f0a6f06ded819) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Rework the camera system into an entity + layer-binding model, and give every scene its own container.
  - The `Camera` class and its service key are removed. Cameras are now entities: `this.spawn(CameraEntity, { position, zoom, rotation, bindings, follow, ... })`. The entity composes `CameraComponent` + `CameraFollow` + `CameraShake` + `CameraZoom` + `CameraBoundsComponent`, all individually addressable via `entity.get(...)`.
  - `CameraEntity` exposes a flat proxy API (`cam.position`, `cam.zoom`, `cam.follow()`, `cam.shake()`, `cam.zoomTo()`, `cam.bounds`) so day-to-day usage doesn't need to reach into components.
  - Cameras bind to named layers. A `CameraEntity` without `bindings` auto-binds every declared `LayerDef` on the scene; explicit `bindings` take an array of `{ layer, translateRatio? }` for parallax. `translateRatio` scales only the translation vector — zoom and rotation still apply at full strength.
  - `DisplaySystem` now iterates every live scene's render tree, resets each layer to identity every frame, and applies enabled cameras sorted by `priority` (highest wins on overlap). Disabling or destroying the last camera on a scene leaves its layers on identity instead of frozen mid-transform.
  - `CameraComponent.screenToWorld` / `worldToScreen` now factor `cam.rotation` into the conversion, matching the rotation actually applied to the layer container.
  - `CameraComponent.viewportWidth` / `viewportHeight` are live getters reading from `RendererKey.virtualSize`, not values snapshotted in `onAdd()`, so world↔screen conversions stay correct after a renderer resize.
  - `CameraBoundsComponent` centers the camera on the bounds rectangle when the viewport is larger than the bounds, instead of clamping to an inverted range.
  - New `CameraShake.stop()` cancels an active shake immediately; decayed intensity is clamped at zero so `decay > 1` no longer inverts the final frames.
  - Each scene now owns a single `Container` (`SceneRenderTree.root`) under the stage. `SceneRenderTreeProvider` adds `getTree(scene)` and `allTrees()`, and `bringSceneToFront(scene)` reorders one root instead of every layer.
  - `LayerDef.eventMode` is removed. `LayerDef.space: "world" | "screen"` (default `"world"`) controls whether cameras auto-bind the layer — world-space layers scroll/zoom with the camera, screen-space layers stay fixed to the viewport. Plugins provision screen-space layers via `tree.ensureLayer(def, { space: "screen" })`. `EnsureLayerOptions` and the `LayerSpace` union are new public types.
  - `CameraKey`, `StageKey`, and `WorldRootKey` are removed. Plugins that need the scene's root container call `provider.getTree(scene).root`.

- [#20](https://github.com/marco-lepore/yage/pull/20) [`6143e03`](https://github.com/marco-lepore/yage/commit/6143e0346820dd74d78b1d345ac4ebc5e4294769) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add scene-scoped DI and generic scene hooks.
  - `SceneRenderTreeKey` is now scene-scoped. `SceneRenderTree`, `SceneRenderTreeProvider`, and `LayerDef` are new public exports.

- [#22](https://github.com/marco-lepore/yage/pull/22) [`083b05b`](https://github.com/marco-lepore/yage/commit/083b05bd9c9557ef32b9b82939e792983c4a5f9b) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add scene transition system with push/pop/replace support, and rework the scene-manager cancellation story.
  - `fade({ duration?, color? })` — fade to solid color and back. Incoming scene hidden until mid-point; outgoing scene hidden at mid-point on pop.
  - `flash({ duration?, color? })` — flash overlay with linear decay. Opaque at begin masks the scene swap.
  - `crossFade({ duration? })` — cross-dissolve between scenes (both visible throughout). `end()` now leaves the outgoing container's alpha at 0 on pop/replace to avoid a one-frame flash between `end()` and the stack mutation.
  - `getSceneContainer(ctx, scene)` — helper for custom transitions, resolves a scene's PIXI root container. All transition exports are also re-exported through `@yagejs/renderer`'s top-level barrel.

### Patch Changes

- [#29](https://github.com/marco-lepore/yage/pull/29) [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Migrate `DisplaySystem`'s defensive `entity.scene` null check to the new `entity.tryScene` introduced in `@yagejs/core`. No behavior change.

- Updated dependencies [[`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`fc717ba`](https://github.com/marco-lepore/yage/commit/fc717bac2bc530a2c396da604d614f762d272232), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c)]:
  - @yagejs/core@0.2.0
