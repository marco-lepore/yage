# @yagejs/ui-react

## 0.10.0

### Minor Changes

- [#214](https://github.com/marco-lepore/yage/pull/214) [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Entities can now be turned off and reused instead of destroyed and respawned: `entity.setActive(false)` puts an entity and its whole subtree to sleep, and components get `onEnable` / `onDisable` to release and reacquire live resources.
  - `UIRoot` hides its React tree while the entity is dormant. Hiding the container also takes the tree out of pointer hit-testing, so a dormant UI no longer claims presses.

### Patch Changes

- [#204](https://github.com/marco-lepore/yage/pull/204) [`8400b55`](https://github.com/marco-lepore/yage/commit/8400b5519cb3401a0ad91ab1be511e3d885cc203) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Correct JSDoc code examples so editor tooltips and the generated API reference match the shipped API. `@yagejs/renderer`: camera `shake`/`zoomTo` example durations are in seconds, and `defaultTextStyle` no longer lists `resolution` (it is a `TextComponent` constructor option, not a style property). `@yagejs/ui-react`: the `SplitText` reveal examples use `Tween.custom` setters instead of `Tween.to`, which only accepts a plain `Record<string, number>`.

- Updated dependencies [[`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`f1048ab`](https://github.com/marco-lepore/yage/commit/f1048ab756feee84e593609521c3a58fcfc1c1a7), [`4a5b3b6`](https://github.com/marco-lepore/yage/commit/4a5b3b639ddcbb285b6a4733b89d27bcee14c50c), [`d459026`](https://github.com/marco-lepore/yage/commit/d4590265b9aa5297fb99d20b92bb5a2f19cac0c5), [`8400b55`](https://github.com/marco-lepore/yage/commit/8400b5519cb3401a0ad91ab1be511e3d885cc203), [`81eafe0`](https://github.com/marco-lepore/yage/commit/81eafe04c3b362832e2dc873bea996f36f4601fd)]:
  - @yagejs/core@0.10.0
  - @yagejs/renderer@0.10.0
  - @yagejs/ui@0.10.0

## 0.9.0

### Minor Changes

- [#172](https://github.com/marco-lepore/yage/pull/172) [`8d061c5`](https://github.com/marco-lepore/yage/commit/8d061c54eb0bbf3aed75b2b943fef1affdce7667) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Fixes three long-standing reconciler bugs and derives JSX prop types from `@yagejs/ui` instead of hand-copying them.
  - Unmounting a React-managed UI element (a `{open && <Panel/>}` toggle, a list item diffed away, or the whole `<UIRoot>` tree torn down) now destroys it, freeing its Yoga node and Pixi resources. Previously only the imperative `@yagejs/ui` API did this — every React unmount leaked.
  - `commitUpdate` now diffs old vs. new props and forwards removed keys as explicit `undefined`, so `bg={selected ? hl : undefined}` and conditional prop spreads (`{...(open ? { onClick } : {})}`) reset the prop instead of leaving the old value.
  - `useQuery` releases its `QueryCache` registration on unmount (see the `@yagejs/core` changeset in this release) instead of leaking one live query per mount.
  - JSX prop interfaces (`PanelProps`, `ButtonProps`, `TextProps`, `CheckboxProps`, `ScrollViewReactProps`, the `Pixi*ReactProps` types, and the rest) now extend their `@yagejs/ui` imperative counterparts instead of hand-copied fields, fixing drift where `consumeInput` compiled on the imperative API but not in JSX (`Checkbox`, `ScrollView`, the Pixi\* wrappers). The dead `PanelProps.anchor` field is removed.
  - `bg` is now a documented JSX-only shorthand for `background` on `Panel`, `Button`, and `ScrollView`, expanded through a shared alias table. Passing both `bg` and `background` on the same element resolves to `background` and dev-warns once per element type. `PixiProgressBar`/`PixiSlider`/`PixiInput`'s own `bg` (a required `@pixi/ui` view-slot prop) is untouched.
  - A bare text/number JSX child (`<Panel>Score: {score}</Panel>`) now dev-warns once, since this reconciler has no host text node and previously dropped the content silently.

### Patch Changes

- [#194](https://github.com/marco-lepore/yage/pull/194) [`8156b6d`](https://github.com/marco-lepore/yage/commit/8156b6dcc8429b738c3efeb949fafd1cce245330) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Rename the UI element/Component split so the `UI*` prefix uniformly means "renderable UIElement".
  - Internal adaptation to the `@yagejs/ui` renames (`UIPanel`, `UIScrollView`, `UIPanelProps`, `UIScrollViewProps`); the public JSX API is unchanged.

- Updated dependencies [[`a5c8be9`](https://github.com/marco-lepore/yage/commit/a5c8be9527ce31a5a8f0ce6b6d94a830d2322c83), [`a5c8be9`](https://github.com/marco-lepore/yage/commit/a5c8be9527ce31a5a8f0ce6b6d94a830d2322c83), [`c62453b`](https://github.com/marco-lepore/yage/commit/c62453b48a5f5dbebdb26c6bab495cc7d5b64195), [`0574e44`](https://github.com/marco-lepore/yage/commit/0574e44d68df2568c57d0275aff139bddebb06da), [`408fea0`](https://github.com/marco-lepore/yage/commit/408fea01e49c45b72fe54d37d389d54873b8594f), [`7832026`](https://github.com/marco-lepore/yage/commit/7832026be2366c774a6119ee830940be31733083), [`3f7a367`](https://github.com/marco-lepore/yage/commit/3f7a367edc5af8d0d78e6e95bcc709bd8b77d783), [`a5d7d53`](https://github.com/marco-lepore/yage/commit/a5d7d5370fb8db567f4ceb39934574ab5c37a174), [`22c05c8`](https://github.com/marco-lepore/yage/commit/22c05c8a561d6361ca3489eaa2d0a0ea5caf2492), [`22f8534`](https://github.com/marco-lepore/yage/commit/22f8534e8dbc9ef054c23a570ab851f8710db68f), [`da97f10`](https://github.com/marco-lepore/yage/commit/da97f10ba7cb7627f48efccf3bfe1836bfac3dbc), [`f6c2fa8`](https://github.com/marco-lepore/yage/commit/f6c2fa8e508620fb5356b8e4481a199115a73a45), [`f6c2fa8`](https://github.com/marco-lepore/yage/commit/f6c2fa8e508620fb5356b8e4481a199115a73a45), [`10d3ac5`](https://github.com/marco-lepore/yage/commit/10d3ac5ec3f3dca593f35728b175df3bfd073bb6), [`8a933db`](https://github.com/marco-lepore/yage/commit/8a933db95eedb908ad98e95631d5022fe1e0ef28), [`9b637bc`](https://github.com/marco-lepore/yage/commit/9b637bcd832476a6c47eb4dacb8cf33e9c5139b0), [`3fbbe3d`](https://github.com/marco-lepore/yage/commit/3fbbe3d3c936f636d5069e296a4ca228b7511c86), [`9b02d02`](https://github.com/marco-lepore/yage/commit/9b02d024fe54ea30efef01a109387b839266b791), [`8156b6d`](https://github.com/marco-lepore/yage/commit/8156b6dcc8429b738c3efeb949fafd1cce245330), [`8156b6d`](https://github.com/marco-lepore/yage/commit/8156b6dcc8429b738c3efeb949fafd1cce245330), [`8d061c5`](https://github.com/marco-lepore/yage/commit/8d061c54eb0bbf3aed75b2b943fef1affdce7667), [`8d061c5`](https://github.com/marco-lepore/yage/commit/8d061c54eb0bbf3aed75b2b943fef1affdce7667), [`0735a9a`](https://github.com/marco-lepore/yage/commit/0735a9a3a1fa6e3f7b8549887b9b87d43674df98), [`82db867`](https://github.com/marco-lepore/yage/commit/82db867c0176208d5968ae3aa68296db3d724955), [`82db867`](https://github.com/marco-lepore/yage/commit/82db867c0176208d5968ae3aa68296db3d724955)]:
  - @yagejs/renderer@0.9.0
  - @yagejs/ui@0.9.0
  - @yagejs/core@0.9.0

## 0.8.0

### Minor Changes

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

- [#94](https://github.com/marco-lepore/yage/pull/94) [`d9e6d00`](https://github.com/marco-lepore/yage/commit/d9e6d00440fb46483199e212476526feb904f237) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add a `flex` shorthand and a dev-mode overflow warning, and let `UIButton` truncate its label.
  - **Keep Yoga's `flexShrink: 0` default; add a `flex` shorthand instead.** UI nodes keep their natural main-axis size and overflow a too-small row/column rather than being crushed. (A global web-style `flexShrink: 1` was tried and reverted: Yoga has no `min-width: auto` content floor, so it crushed fixed-size siblings and collapsed `ScrollView` content, which must exceed its viewport to scroll.) Shrinking/wrapping is opt-in — set `flexShrink: 1`, or use the new **`flex: <number>`** prop (shorthand for `flexGrow: <n>` + `flexShrink: 1` + `flexBasis: 0`, the CSS `flex` rule) for a child that should fill the remaining space and wrap cleanly. Prefer `flex: 1` over `flexGrow: 1` for that case, since `flexGrow: 1` alone keeps `flexBasis: auto` (content width) and overflows.
  - **Dev-mode overflow warning.** When an in-flow child's computed box still spills past its container's content box (any edge), a one-time `console.warn` points at the offending node. Compiled out of production builds (`NODE_ENV=production`) and silenced for intentional overflow — `overflow: "hidden"` containers, `position: "absolute"` children, and `ScrollView` content. The warning clears once a node fits again, so a later re-overflow re-warns. New internal helpers `warnChildOverflow` / `exemptFromOverflowWarning` back this.
  - **`UIButton` gains `truncate?: "clip" | "ellipsis"`**, forwarded to the auto-created label `UIText` (through construction, `setText()` promotion, and `update()`). A fixed-size button can keep a long/i18n label on one line and ellipsize it instead of spilling out of the frame.
  - **`ScrollView` keeps its natural sizing.** With `flexShrink: 0` restored, a fixed toolbar/footer beside a `flexGrow` scroll viewport keeps its size by default (no special-casing needed), and the viewport sizes to its content in an auto-height/`maxHeight` parent instead of collapsing. Use `flex: 1` (basis 0) when you want it to fill a definite-height parent; an explicit `flexBasis` is honored.

### Patch Changes

- [#113](https://github.com/marco-lepore/yage/pull/113) [`81a001e`](https://github.com/marco-lepore/yage/commit/81a001e986ad11a70fe7f3b7318b34132be2dfaa) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Bring the floating/tooltip system to the non-React `@yagejs/ui` layer with a new headless `attachTooltip`.

  The `FloatingOverlay`, its `FloatingOverlayKey`, the pure `computePosition` positioning engine, `FloatConfig` / `FloatingHandle`, and the `layoutFloat` helper now live in `@yagejs/ui` (previously React-only). The overlay is framework-agnostic: `FloatingHandle` carries a `setLayout(fn)` callback so the overlay no longer reaches into the React reconciler to measure its content.
  - **`@yagejs/ui` — `attachTooltip(anchor, scene, { content, placement, offset, maxWidth })`**. Imperative, headless tooltip that parents a content node into the scene overlay and anchors it to a root `UIPanel` or any `UIElement` (`UIButton`, `UIImage`, a nested `PanelNode`, …). It builds the floating parts and returns a `{ setActive, dispose }` controller — it wires **no input of its own**, so it never clobbers the anchor's handlers. You drive activation: set `onHover` on a panel via `panel.setPointerHandlers({ onHover: tip.setActive })` or on an element via `element.update({ onHover: tip.setActive })` (setting it replaces that single slot, so compose explicitly if the anchor already has one), or trigger from focus / long-press / programmatically. `anchor` is read only for positioning, and `setActive` stays a safe no-op after `dispose()`. Works in a pure imperative scene with **no `<UIRoot>` / React** — diegetic UI like `ScreenFollow` namecards can now have tooltips.
  - **`@yagejs/ui` — `UIPanel.setPointerHandlers(props)`** + `attachTooltip` accepting a `UIPanel` directly. A root `UIPanel` is a `Component` wrapping the renderable `PanelNode`; `attachTooltip` now unwraps it, and `setPointerHandlers` forwards pointer/hover props (`onHover`, `onPointerOver`, `onPointerOut`) to the node — so anchoring a tooltip to a whole panel no longer needs the `@internal` `._node`. (`update()` can't double as the panel's prop setter — on a `Component` it's the per-frame lifecycle hook.) The deeper `UIPanel`/`PanelNode` rename is tracked in [#124](https://github.com/marco-lepore/yage/issues/124).
  - **`@yagejs/ui` — `FloatingOverlaySystem`** (`Phase.LateUpdate`, priority `201`, registered by `UIPlugin`). Walks `SceneManager.activeScenes` and re-anchors each scene's overlay every frame after `UILayoutSystem`, with or without a `UIRoot`.
  - **`@yagejs/ui` — `UIPlugin`** now provisions the scene-scoped `FloatingOverlay` (via scene hooks) so floating UI exists independently of React. `computePosition`, `parsePlacement`, `Placement` / `Side` / `Align` / `Rect` / `Dimensions`, `FloatConfig`, `FloatingHandle`, `FloatingOverlay`, `FloatingOverlayKey`, and `layoutFloat` are exported as escape hatches for custom popovers / menus.

  `@yagejs/ui-react` re-exports the moved symbols from `@yagejs/ui` for back-compat (`FloatingOverlayCtx` stays React-only), `useFloating` supplies the reconciler-specific `setLayout`, and `UIReactPlugin` no longer double-registers the overlay (now owned by `UIPlugin`). The React `<Tooltip>` / `useFloating` API is unchanged.

- Updated dependencies [[`62da81f`](https://github.com/marco-lepore/yage/commit/62da81f67076fccaff3a8af6c805dd919c6a687f), [`62da81f`](https://github.com/marco-lepore/yage/commit/62da81f67076fccaff3a8af6c805dd919c6a687f), [`cc29414`](https://github.com/marco-lepore/yage/commit/cc29414877a074688a411d93f7ecf6781ca82ea2), [`2982d21`](https://github.com/marco-lepore/yage/commit/2982d21facc865261e258ee02dc6b8000f226e9f), [`8e2ab0b`](https://github.com/marco-lepore/yage/commit/8e2ab0b301748c2ac5f3d90224d3a2cc92393865), [`face78b`](https://github.com/marco-lepore/yage/commit/face78ba63f9ef6eb52d8a677fc1d8b1457212e6), [`81a001e`](https://github.com/marco-lepore/yage/commit/81a001e986ad11a70fe7f3b7318b34132be2dfaa), [`555a868`](https://github.com/marco-lepore/yage/commit/555a86888ec3aedca42587fab7eb3ec5f0c6eeb8), [`664748f`](https://github.com/marco-lepore/yage/commit/664748fdf3c6a9527981746d0c5bd2528db4402d), [`664748f`](https://github.com/marco-lepore/yage/commit/664748fdf3c6a9527981746d0c5bd2528db4402d), [`4627c80`](https://github.com/marco-lepore/yage/commit/4627c80e409226ff58c2214c2e1bb76e9e1d769f), [`cafa74c`](https://github.com/marco-lepore/yage/commit/cafa74cbe90ec1143c60dcfd782a0a76c8d859dd), [`3991288`](https://github.com/marco-lepore/yage/commit/39912883cf191cd065ef0b5779f1b65b53bcbea8), [`23e357f`](https://github.com/marco-lepore/yage/commit/23e357f605957cc24e58ec2e504a82d4ebdcc9a0), [`d9e6d00`](https://github.com/marco-lepore/yage/commit/d9e6d00440fb46483199e212476526feb904f237), [`68e7243`](https://github.com/marco-lepore/yage/commit/68e72436209f7e03f0e8ad0bde94f3d23562bcbe)]:
  - @yagejs/core@0.8.0
  - @yagejs/renderer@0.8.0
  - @yagejs/ui@0.8.0

## 0.7.0

### Minor Changes

- [#77](https://github.com/marco-lepore/yage/pull/77) [`8d80f18`](https://github.com/marco-lepore/yage/commit/8d80f1856ac897e8dcaa28543d57ff16750e97f3) Thanks [@marco-lepore](https://github.com/marco-lepore)! - BitmapText path for pixel-art text + per-text `resolution`.
  - `TextComponent` and `UIText` accept a new `bitmap?: boolean | { font?: string; size?: number }` option. `true` bakes a dynamic bitmap font from the text's own `style`; the object form renders with an installed/loaded font by name (`size` overrides the glyph size). Canvas-rasterised Pixi `Text` is bilinear-sampled and goes blurry at non-integer scale on non-Retina displays — `BitmapText` draws crisp pre-baked glyph quads instead. Yoga measurement (the PR [#67](https://github.com/marco-lepore/yage/issues/67) word-wrap / `truncate` semantics) is unchanged on the bitmap path.
  - New `bitmapFont(path)` asset factory (wired into the renderer asset pipeline as the `"bitmap-font"` loader) for BMFont `.fnt`/`.xml` + atlas descriptors, plus an async `installBitmapFont(source, opts)` helper that loads a `.ttf` and bakes a glyph atlas via Pixi v8's `BitmapFont.install`, returning the registered font name.
  - New `resolution?: number` constructor option on `TextComponent` / `UIText` (and the React `<Text>` wrapper). Pixi v8 `resolution` is a `Text` constructor option, NOT a `TextStyle` property — this is the only way to get crisp canvas text without a prototype patch. Ignored when `bitmap` is set (bitmap resolution is fixed at font-bake time).
  - `TextComponent` serialization round-trips `bitmap` and `resolution`. `@yagejs/ui-react`'s `TextProps` gains the same two props.
  - `bitmap` / `resolution` are construction-only — Pixi v8 can't morph `Text`↔`BitmapText` or change `resolution` in place. `UIText.update()` (the React reconciler path) emits a dev-mode warning when either changes instead of silently dropping it; remount the element (e.g. change its React `key`) to switch.

- [#78](https://github.com/marco-lepore/yage/pull/78) [`b1148ae`](https://github.com/marco-lepore/yage/commit/b1148aec0775ac46a652c1c4e714dfea22525400) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Declarative scrollable lists via `<ScrollView>` / `ScrollViewNode`; removed `PixiScrollBox`.
  - New `ScrollViewNode` (`@yagejs/ui`) — a true `UIContainerElement` clipped, scrollable viewport. Children are first-class Yoga nodes laid out by the existing pass (the scrollable content is a composed `PanelNode`), so it works identically three ways: the React reconciler (`<ScrollView>` in `@yagejs/ui-react`), the `PanelNode` / `UIPanel` `.scrollView(opts)` builder, and direct `addElement`. Wheel + drag are wired through pixi federated events on the node itself (no DI / `useEngine` coupling). Public `scrollBy()` / `scrollTo()` / `scrollOffset` / `maxScroll` for programmatic control. Imperative options (`ScrollViewProps` / `ScrollViewNode` / `.scrollView()`): `direction`, `gap`, `padding`, `scrollbar`, `background`, `onScroll` plus `LayoutProps` (`width` / `height` / `flexGrow` size the viewport). In `@yagejs/ui-react`, `<ScrollView>` takes the same props but uses the shorthand `bg` (not `background`) for the background, matching `<Panel>`.
  - Scroll position is preserved across re-renders for free: the reconciler keeps the node instance stable and only diffs children, so the offset (an instance field) survives store-driven updates and is re-clamped when the list shrinks.
  - **Removed** `PixiScrollBox`, `<PixiScrollBox>`, and `PixiScrollBoxProps`. The `@pixi/ui` ScrollBox wrapper was append-only and a Yoga leaf — it silently dropped JSX children. `<ScrollView>` replaces it as the single scroll primitive. `PixiSelect` is unaffected (it wraps `@pixi/ui` `Select` directly).
  - Fixed: a `<ScrollView>` nested in a flex parent (e.g. `flexGrow={1}` inside a fixed-height `<Panel>` — the primary documented usage) grew to its content height and never scrolled. The viewport now sets `minWidth/minHeight: 0` and `flexShrink: 1` (the Yoga equivalent of the CSS `min-height:0` scroll-container fix — Yoga's default `flexShrink` is `0`, unlike the web's `1`), so a flex parent can size it below its overflowing content. Explicit props still win.
  - The viewport has an explicit `hitArea` synced to its box, so wheel + drag work anywhere over the `ScrollView` — gaps between cards, the scrollbar gutter, empty space below the last card — not only directly over a rendered child. (A bare `eventMode:"static"` Container is hit-tested only where a descendant paints; previously input was dead in uncovered regions unless a full-bleed `background` happened to cover them.)
  - The scrollbar is configurable: `scrollbar` accepts `true` / `false` or a `ScrollbarOptions` object (`thickness`, `color`, `alpha`, `radius`, `minThumbLength`, `margin`). When shown, a gutter equal to the thumb footprint is auto-reserved on the scroll-cross edge so content never renders under the thumb; `node.scrollbarGutter` exposes that width.
  - The reconciler now emits a one-shot dev-mode `console.warn` (via `@yagejs/core` `devWarn`) when JSX children are appended to a layout-leaf element that has no `addElement()`, turning the previously silent "why is my box empty?" failure into an actionable message.

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

- [#65](https://github.com/marco-lepore/yage/pull/65) [`29bf5d5`](https://github.com/marco-lepore/yage/commit/29bf5d573c60f4eeeeb9af102d7a6c0d2f8e6ed8) Thanks [@marco-lepore](https://github.com/marco-lepore)! - UI primitives: Button auto-size + ReactNode children, absolute positioning, `<ZStack>` overlay primitive.
  - `LayoutProps` gains `position` (`"relative" | "absolute"`, default `"relative"`), `left`, `top`, `right`, `bottom`. Wired to Yoga's `setPositionType` + `setPosition`, so every element can be absolutely positioned against the nearest relative ancestor.
  - `UIButton` is now a flex container (implements `UIContainerElement`): `addElement` / `removeElement` / `insertElementBefore` work on it directly. The legacy `panel.button("Label", ...)` API still creates a centered auto-text child; the new container surface enables icon + label compositions.
  - `@yagejs/ui-react` `ButtonProps.width` / `.height` are now optional and accept the full `LayoutValue` union (pixels, `%`, `vw` / `vh`, `"auto"`). Omit to shrink-to-fit the button's content. `children` accepts `ReactNode` — strings / numbers auto-wrap in a centered `<Text style={textStyle}>`, elements render as flex children. `ButtonProps.truncate` forwards into the auto-wrapped `<Text>` so fixed-width buttons can ellipsize long labels.
  - New `<ZStack>` JSX primitive: a `<Panel>` that defaults to filling its parent with `position: "relative"`, intended as the containing block for Z-axis overlay children (modal backdrops, HUD layers, badge markers). Named after SwiftUI's `ZStack` to distinguish from flex column / row stacking (`<Panel direction="column" | "row">`).

- [#80](https://github.com/marco-lepore/yage/pull/80) [`c8f6038`](https://github.com/marco-lepore/yage/commit/c8f603805c1eb03629113489f30be2529eb0472b) Thanks [@marco-lepore](https://github.com/marco-lepore)! - UI hover events + `<Tooltip>`, and percentage edge offsets for absolute positioning.
  - New shared `PointerEventProps` (exported): `onPointerOver?()`, `onPointerOut?()`, and a convenience `onHover?(hovering: boolean)` (`true` on enter / `false` on leave). Wired into `UIButton`, `PanelNode` / `UIPanel`, `UIText`, `UIImage`, `UINineSlice`, `UIProgressBar` — and the matching `@yagejs/ui-react` JSX components (`<Panel>`, `<Button>`, `<Text>`, `<Image>`, `<NineSlice>`, `<ProgressBar>`). Every UI primitive's container is already `eventMode: "static"`, so this is a fan-out, not new infra. A new exported `PointerEvents` helper binds one listener pair and swaps callbacks in place across `update()`; `UIButton` suppresses callbacks while disabled.
  - `LayoutProps` `left` / `top` / `right` / `bottom` now accept a `"<n>%"` string in addition to a number (`PositionValue`). Percentages resolve against the containing block, so an absolute child can pin flush to a parent edge (`top: "100%"`) without measuring it.
  - New floating-UI system in `@yagejs/ui-react`, built on a real React-reconciler **portal** + a per-scene **screen-space overlay** (`FloatingOverlay`, a scene-scoped service registered by `UIReactPlugin`; one top-most `"ui-overlay"` layer shared by every `UIRoot`):
    - **`useFloating()`** — exported headless primitive. Acquires an overlay slot, anchors it to a trigger via the trigger's world→screen rect (so world-space / camera-transformed triggers anchor correctly), and portals content there while keeping it in the caller's React tree (context/props/lifecycle flow normally). Tooltip/popover/menu build on this.
    - **`computePosition()`** — exported pure positioning engine (Floating-UI-style middleware: `offset` → `flip` → `shift` → `size`). `Placement` is now `side` or `side-align` (`"top"`, `"bottom-start"`, `"right-end"`, …; default center-aligned). Bubbles flip to the opposite side and shift along the cross axis to stay on-screen.
    - **`<Tooltip content={…}>`** — a Mantine-style wrapper (single component, body in a `content` prop) on top of `useFloating`. **Now headless**: no default visuals — pass `bg` / `padding` / `textStyle` to style it. Props: `content`, `placement` (`Placement`, default `"top"`), `offset`, new `maxWidth` (caps width — content wraps instead of running off-screen, and always clamps to the space available at the resolved side), `bg`, `padding`, `textStyle`, `opened`, `disabled`. Draws above all UI, escapes `<ScrollView>` clips, never reflows siblings, and z-stacks across roots (most-recently-opened on top). Without a `<UIRoot>` overlay it falls back to an in-tree absolute bubble (no collision handling).
    - Removes the previous per-`UIRoot` `_overlay` / `TooltipController` controller-and-imperative-positioning approach entirely.
  - `@yagejs/ui-react` `PanelProps` now exposes `consumeInput?: boolean` (already forwarded to `PanelNode`; previously untyped) so a decorative / pass-through panel can opt out of the UI auto-consume pointer fallback.

- [#67](https://github.com/marco-lepore/yage/pull/67) [`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40) Thanks [@marco-lepore](https://github.com/marco-lepore)! - UIText overflow controls: word-wrap by default + `truncate` option.
  - When Yoga gives `UIText` a width constraint (`AtMost` / `Exactly`), the measure callback now enables `wordWrap` with the constraint as `wordWrapWidth` before reading `text.height`, so multi-line text is sized correctly inside a fixed-width slot.
  - New `truncate?: "clip" | "ellipsis"` prop on `UIText` (and the React `<Text>` wrapper). Both modes are single-line and substring-truncate to fit the slot — `"clip"` cuts at the character boundary, `"ellipsis"` cuts shorter and appends `…`. The text stays bounded by its own yoga slot rather than depending on a parent `overflow: hidden` to mask the overflow.
  - `TextProps` in `@yagejs/ui-react` now extends `LayoutProps`, so `<Text width={...} flex={1} />` and friends are typed correctly.

### Patch Changes

- [#84](https://github.com/marco-lepore/yage/pull/84) [`6e48def`](https://github.com/marco-lepore/yage/commit/6e48def8a2d36dd38faeedebda813427a8b6dd86) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Fix: `Panel` / `PanelNode` pointer & hover events no longer have dead-zones over un-painted regions.

  `PanelNode` now sets an explicit `hitArea` synced to its computed Yoga box every `applyLayout()` (mirroring `ScrollViewNode`'s viewport). A bare `eventMode:"static"` Container is hit-tested only where a descendant actually paints, so previously `onHover` / `onPointerOver` / `onClick` (and `<Tooltip>`, whose trigger wrapper is a `Panel`) silently never fired over flex `gap`, `padding`, or the empty space around shrink-wrapped children on a background-less panel — events landed only over painted descendants. The handlers now fire anywhere within the panel's layout box, and the UI auto-consume pointer fallback likewise covers the whole box. A panel with a full-bleed `background` is unaffected (its background already covered the box).

- Updated dependencies [[`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40), [`8d80f18`](https://github.com/marco-lepore/yage/commit/8d80f1856ac897e8dcaa28543d57ff16750e97f3), [`069d41e`](https://github.com/marco-lepore/yage/commit/069d41e711aeb6218c1438f52a2b098ff8946526), [`90e4d30`](https://github.com/marco-lepore/yage/commit/90e4d3064d9c2804549d62844067cf487d592f0a), [`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40), [`6e48def`](https://github.com/marco-lepore/yage/commit/6e48def8a2d36dd38faeedebda813427a8b6dd86), [`57a6441`](https://github.com/marco-lepore/yage/commit/57a6441f9ef8b5f7140959d6393930c2326d70e0), [`0e9f86c`](https://github.com/marco-lepore/yage/commit/0e9f86cc42bb632d38a67c22aa31b6dd21cf82e7), [`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40), [`b1148ae`](https://github.com/marco-lepore/yage/commit/b1148aec0775ac46a652c1c4e714dfea22525400), [`7ca5050`](https://github.com/marco-lepore/yage/commit/7ca5050d91479121039af5e4898fc0c220e8d7c3), [`29bf5d5`](https://github.com/marco-lepore/yage/commit/29bf5d573c60f4eeeeb9af102d7a6c0d2f8e6ed8), [`c8f6038`](https://github.com/marco-lepore/yage/commit/c8f603805c1eb03629113489f30be2529eb0472b), [`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40)]:
  - @yagejs/renderer@0.7.0
  - @yagejs/ui@0.7.0
  - @yagejs/core@0.7.0

## 0.6.0

### Patch Changes

- [#55](https://github.com/marco-lepore/yage/pull/55) [`e4d8823`](https://github.com/marco-lepore/yage/commit/e4d882380e37a02c8fd259c5019c576a46f9aa89) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Typed reactive stores in core + a new Save IO instance built on them; snapshot system renamed to free the `Save*` namespace.
  - `Store` and `createStore` now re-export from `@yagejs/core`'s state module — single source of truth for the reactive store primitive.
  - `useStore` works unchanged on the new persistent stores from core (`defineStore` / `defineSet` / `defineMap` / `defineCounter`).

- Updated dependencies [[`cd26383`](https://github.com/marco-lepore/yage/commit/cd2638345e54709a2a5281334dc71448de64f4cf), [`47ffab6`](https://github.com/marco-lepore/yage/commit/47ffab6b37423155f92e97519b66b73e14b73039), [`9a2519b`](https://github.com/marco-lepore/yage/commit/9a2519ba9ed739cacc116699fc2944eb54930e23), [`cd26383`](https://github.com/marco-lepore/yage/commit/cd2638345e54709a2a5281334dc71448de64f4cf), [`1126143`](https://github.com/marco-lepore/yage/commit/11261436719fed28472cec3143281632f082add5), [`d9be1b3`](https://github.com/marco-lepore/yage/commit/d9be1b365ae83a8ca365d72003ec23e6fbb8679f), [`fe4aabc`](https://github.com/marco-lepore/yage/commit/fe4aabcf25525d078e584ab96e69dd907d96bc7c), [`fe4aabc`](https://github.com/marco-lepore/yage/commit/fe4aabcf25525d078e584ab96e69dd907d96bc7c)]:
  - @yagejs/renderer@0.6.0
  - @yagejs/core@0.6.0
  - @yagejs/ui@0.6.0

## 0.5.0

### Minor Changes

- [#52](https://github.com/marco-lepore/yage/pull/52) [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Input ergonomics: frame-deferred action edges, pointer/wheel consume primitives, listener parity, and UI auto-consume via the renderer's hit-test fallback.
  - `UIRoot` marks its host container as a consume surface so pointer events landing inside the React tree are automatically claimed by `@yagejs/input` (no per-component wiring required). New `consumeInput?: boolean` option on `UIRootOptions` (default `true`) — set `false` for transparent overlays that should let clicks pass through to gameplay.
  - React UI mirrors (`Panel`, `Button`, `Checkbox`, `Image`, `NineSlice`, `ProgressBar`, `UIText`, plus the `Pixi*` wrappers) automatically forward the new `consumeInput` prop to their underlying `@yagejs/ui` primitives — no public API change in `components.tsx`.

### Patch Changes

- Updated dependencies [[`cf617fe`](https://github.com/marco-lepore/yage/commit/cf617fe0f28db6ea1a5af7992b76dc19eec8cd0c), [`bc3790d`](https://github.com/marco-lepore/yage/commit/bc3790dc4c31c42c4821cd275a9376a0830bb0db), [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b), [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b), [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b), [`114d246`](https://github.com/marco-lepore/yage/commit/114d246820a88e68841a4f9cec2167c188269970)]:
  - @yagejs/renderer@0.5.0
  - @yagejs/core@0.5.0
  - @yagejs/ui@0.5.0

## 0.4.0

### Minor Changes

- [#45](https://github.com/marco-lepore/yage/pull/45) [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Inspector deterministic test mode and per-package serialization plumbing for `Inspector.snapshot()`.
  - `UIRoot` is now `@serializable`. The component snapshots its constructor options (size, offset, layer, positioning) on construction and replays them through `fromSnapshot()` so React-rendered UI roots are captured by inspector snapshots and save slots. The reconciler also publishes element identities used by inspector UI-tree snapshots.

### Patch Changes

- Updated dependencies [[`e7d6645`](https://github.com/marco-lepore/yage/commit/e7d6645f9acff27269fa6f6e52032482651b146d), [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805), [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805), [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805), [`08efa94`](https://github.com/marco-lepore/yage/commit/08efa94a8be02ba56c1df9d3bed643abcc1d7159)]:
  - @yagejs/renderer@0.4.0
  - @yagejs/core@0.4.0
  - @yagejs/ui@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [[`69f8449`](https://github.com/marco-lepore/yage/commit/69f844942d1596228a6ed50a37ec8e6f1d821353), [`c5e2656`](https://github.com/marco-lepore/yage/commit/c5e2656bd3dab4020a303e34dd77ccbd60ef4ca4), [`60d2067`](https://github.com/marco-lepore/yage/commit/60d20671e31230f5fcef127203efb127bdfedf92), [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb), [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb), [`c5e2656`](https://github.com/marco-lepore/yage/commit/c5e2656bd3dab4020a303e34dd77ccbd60ef4ca4)]:
  - @yagejs/core@0.3.0
  - @yagejs/renderer@0.3.0
  - @yagejs/ui@0.3.0

## 0.2.0

### Minor Changes

- [#30](https://github.com/marco-lepore/yage/pull/30) [`233aed2`](https://github.com/marco-lepore/yage/commit/233aed24dcd68e020a20a030d13668224ce22c4b) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `UIRootOptions.positioning` — mirrors the `@yagejs/ui` `UIPanel` change.
  - `positioning: "anchor"` (default) — `anchor` resolves against the viewport.
  - `positioning: "transform"` — the React tree is pinned to `entity.get(Transform).worldPosition` in the target layer's local coord space; `anchor` is the pivot on the rendered tree. Throws at add time if the entity has no `Transform`.

  Pair `positioning: "transform"` with `ScreenFollow` from `@yagejs/renderer` for entity-anchored React UI (nameplates, health bars, damage numbers) that stays axis-aligned and constant-size under any camera transform.

  **Breaking:** `@yagejs/ui-react` now ships a `UIReactPlugin` that must be registered alongside `UIPlugin` (`engine.use(new UIReactPlugin())`). It installs a `LateUpdate`-phase layout system so `UIRoot` positioning runs after Update-phase Transform writers — the same phase ordering `UIPanel` has always had. Previously `UIRoot` laid out inside `Component.update()` (Phase.Update), which was a latent race with any Update-phase Transform writer. `UIRoot.onAdd()` now throws a clear error if the plugin is missing, so forgetting to register it is no longer a silent failure.

### Patch Changes

- [#21](https://github.com/marco-lepore/yage/pull/21) [`32b35dc`](https://github.com/marco-lepore/yage/commit/32b35dcc89b5e28fdb852a08127f0a6f06ded819) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Rework the camera system into an entity + layer-binding model, and give every scene its own container.
  - `UIRoot` auto-provisions its default `"ui"` layer via `ensureLayer(def, { space: "screen" })` so it stays fixed to the viewport under a default camera, matching `UIPanel`.

- [#17](https://github.com/marco-lepore/yage/pull/17) [`6b6df0f`](https://github.com/marco-lepore/yage/commit/6b6df0f5b0c288ad45b14226716fd36f0503c851) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add missing `@yagejs/renderer` dependency.

- Updated dependencies [[`233aed2`](https://github.com/marco-lepore/yage/commit/233aed24dcd68e020a20a030d13668224ce22c4b), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`fc717ba`](https://github.com/marco-lepore/yage/commit/fc717bac2bc530a2c396da604d614f762d272232), [`fc717ba`](https://github.com/marco-lepore/yage/commit/fc717bac2bc530a2c396da604d614f762d272232), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`233aed2`](https://github.com/marco-lepore/yage/commit/233aed24dcd68e020a20a030d13668224ce22c4b)]:
  - @yagejs/renderer@0.2.0
  - @yagejs/ui@0.2.0
  - @yagejs/core@0.2.0
