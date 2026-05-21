# @yagejs/ui

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

- Updated dependencies [[`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40), [`8d80f18`](https://github.com/marco-lepore/yage/commit/8d80f1856ac897e8dcaa28543d57ff16750e97f3), [`069d41e`](https://github.com/marco-lepore/yage/commit/069d41e711aeb6218c1438f52a2b098ff8946526), [`90e4d30`](https://github.com/marco-lepore/yage/commit/90e4d3064d9c2804549d62844067cf487d592f0a), [`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40), [`57a6441`](https://github.com/marco-lepore/yage/commit/57a6441f9ef8b5f7140959d6393930c2326d70e0), [`0e9f86c`](https://github.com/marco-lepore/yage/commit/0e9f86cc42bb632d38a67c22aa31b6dd21cf82e7), [`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40), [`7ca5050`](https://github.com/marco-lepore/yage/commit/7ca5050d91479121039af5e4898fc0c220e8d7c3)]:
  - @yagejs/renderer@0.7.0
  - @yagejs/core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [[`cd26383`](https://github.com/marco-lepore/yage/commit/cd2638345e54709a2a5281334dc71448de64f4cf), [`47ffab6`](https://github.com/marco-lepore/yage/commit/47ffab6b37423155f92e97519b66b73e14b73039), [`9a2519b`](https://github.com/marco-lepore/yage/commit/9a2519ba9ed739cacc116699fc2944eb54930e23), [`cd26383`](https://github.com/marco-lepore/yage/commit/cd2638345e54709a2a5281334dc71448de64f4cf), [`1126143`](https://github.com/marco-lepore/yage/commit/11261436719fed28472cec3143281632f082add5), [`d9be1b3`](https://github.com/marco-lepore/yage/commit/d9be1b365ae83a8ca365d72003ec23e6fbb8679f), [`fe4aabc`](https://github.com/marco-lepore/yage/commit/fe4aabcf25525d078e584ab96e69dd907d96bc7c), [`fe4aabc`](https://github.com/marco-lepore/yage/commit/fe4aabcf25525d078e584ab96e69dd907d96bc7c)]:
  - @yagejs/renderer@0.6.0
  - @yagejs/core@0.6.0

## 0.5.0

### Minor Changes

- [#52](https://github.com/marco-lepore/yage/pull/52) [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Input ergonomics: frame-deferred action edges, pointer/wheel consume primitives, listener parity, and UI auto-consume via the renderer's hit-test fallback.
  - Every UI primitive (`UIButton`, `UICheckbox`, `UIPanel`, `UIImage`, `UINineSlice`, `UIProgressBar`, `UIText`) now marks its underlying Pixi container via `markPointerConsumeContainer` from `@yagejs/core`. Combined with the renderer's `hitTestUI` and `@yagejs/input`'s drain-time fallback, taps on any UI element — including blank panel backgrounds, decorative text, and layout containers with no handlers — automatically suppress gameplay action edges (`MouseLeft` / `Middle` / `Right`).
  - New per-component escape hatch: `consumeInput?: boolean` on every UI prop interface (default `true`). Set to `false` for see-through overlays (cosmetic full-screen filters, decorative HUD borders) that should let pointer events propagate to gameplay. Lives on the underlying primitive props so it propagates through `@yagejs/ui-react` mirrors with no extra wiring.

### Patch Changes

- Updated dependencies [[`cf617fe`](https://github.com/marco-lepore/yage/commit/cf617fe0f28db6ea1a5af7992b76dc19eec8cd0c), [`bc3790d`](https://github.com/marco-lepore/yage/commit/bc3790dc4c31c42c4821cd275a9376a0830bb0db), [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b), [`d998fc1`](https://github.com/marco-lepore/yage/commit/d998fc16746ee56ff3cad22a5fdf77b2ac19800b), [`114d246`](https://github.com/marco-lepore/yage/commit/114d246820a88e68841a4f9cec2167c188269970)]:
  - @yagejs/renderer@0.5.0
  - @yagejs/core@0.5.0

## 0.4.0

### Minor Changes

- [#45](https://github.com/marco-lepore/yage/pull/45) [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Inspector deterministic test mode and per-package serialization plumbing for `Inspector.snapshot()`.
  - `UIPanel` is now `@serializable`. `LoadingSceneProgressBar` records its constructor options on setup and round-trips through `serialize()` / `fromSnapshot()` so it survives save/load and inspector snapshot diffs.

### Patch Changes

- Updated dependencies [[`e7d6645`](https://github.com/marco-lepore/yage/commit/e7d6645f9acff27269fa6f6e52032482651b146d), [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805), [`0711684`](https://github.com/marco-lepore/yage/commit/0711684b642da76cd29bf250eccc646d89360805), [`08efa94`](https://github.com/marco-lepore/yage/commit/08efa94a8be02ba56c1df9d3bed643abcc1d7159)]:
  - @yagejs/renderer@0.4.0
  - @yagejs/core@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [[`69f8449`](https://github.com/marco-lepore/yage/commit/69f844942d1596228a6ed50a37ec8e6f1d821353), [`c5e2656`](https://github.com/marco-lepore/yage/commit/c5e2656bd3dab4020a303e34dd77ccbd60ef4ca4), [`60d2067`](https://github.com/marco-lepore/yage/commit/60d20671e31230f5fcef127203efb127bdfedf92), [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb), [`b3ed554`](https://github.com/marco-lepore/yage/commit/b3ed554e7cc60c1583a5379311fbf9e47ec373cb), [`c5e2656`](https://github.com/marco-lepore/yage/commit/c5e2656bd3dab4020a303e34dd77ccbd60ef4ca4)]:
  - @yagejs/core@0.3.0
  - @yagejs/renderer@0.3.0

## 0.2.0

### Minor Changes

- [#21](https://github.com/marco-lepore/yage/pull/21) [`32b35dc`](https://github.com/marco-lepore/yage/commit/32b35dcc89b5e28fdb852a08127f0a6f06ded819) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Rework the camera system into an entity + layer-binding model, and give every scene its own container.
  - `UIPanel` auto-provisions a `"ui"` layer via `ensureLayer(def, { space: "screen" })` when the scene didn't declare one, keeping UI pinned to the viewport without any camera wiring.
  - `UIPanel` can now target a world-space layer deliberately — declare a `LayerDef` with `space: "world"` (the default) and pass its name via `UIPanelOptions.layer` to get diegetic UI that follows the camera (interaction prompts, entity-anchored health bars, damage numbers). The previous throw that rejected UI on camera-auto-bindable layers is gone; the layer's declared `space` is now the single source of truth.
  - `layer.container.eventMode = "static"` is applied whether UIPanel creates the layer or reuses an existing one, so HUD hit-testing works in both cases.

- [#26](https://github.com/marco-lepore/yage/pull/26) [`fc717ba`](https://github.com/marco-lepore/yage/commit/fc717bac2bc530a2c396da604d614f762d272232) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `LoadingSceneProgressBar` — default visual for `@yagejs/core`'s `LoadingScene`.
  - Entity subclass. Spawn it inside a `LoadingScene` from `onEnter` (throws otherwise).
  - Subscribes to `scene:loading:progress` on the engine event bus and updates a `UIProgressBar`.
  - Customizable: `width`, `height`, `track`, `fill`, `anchor`, `offset`, `layer`.
  - Optional `backdrop` for a full-viewport background behind the bar — recommended whenever the loading scene is used with a transition, otherwise the outgoing scene bleeds through during the fade. Implemented as a sibling entity whose lifetime is tied to the progress bar.
  - For custom visuals (spinners, animated text, etc.), write a component that subscribes to the same event — same idiom this widget uses internally.

- [#30](https://github.com/marco-lepore/yage/pull/30) [`233aed2`](https://github.com/marco-lepore/yage/commit/233aed24dcd68e020a20a030d13668224ce22c4b) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `UIPanelOptions.positioning` for Transform-driven panel positioning.
  - `positioning: "anchor"` (default) — unchanged; `anchor` resolves against the viewport (`virtualSize`). Existing HUDs and menus keep working as-is.
  - `positioning: "transform"` — panel is positioned at `entity.get(Transform).worldPosition` in the target layer's local coord space; `anchor` is reinterpreted as the pivot on the panel itself (e.g. `Anchor.BottomCenter` → panel's bottom-center sits at the Transform). Throws at add time if the entity has no `Transform`.

  The option is orthogonal to the layer's `space`, which lets two patterns fall out:
  - **Screen-space layer + `positioning: "transform"`** — pair with `ScreenFollow` from `@yagejs/renderer` (writes `cam.worldToScreen(target) + offset` to the Transform each frame; offset is in screen pixels, applied post-projection) for entity-anchored UI that stays axis-aligned and constant-size under camera zoom / rotation. The new `world-ui` example demonstrates this with nameplates and health bars.
  - **World-space layer + `positioning: "transform"`** — for genuinely diegetic UI (signs in the world, in-game displays) that scales and rotates with the camera like any other world object.

  Also exports a new `pivotOffsetFromAnchor(anchor, pw, ph)` helper alongside `resolveAnchor`, and the `UIPositioning` type.

### Patch Changes

- [#20](https://github.com/marco-lepore/yage/pull/20) [`6143e03`](https://github.com/marco-lepore/yage/commit/6143e0346820dd74d78b1d345ac4ebc5e4294769) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Adopt scene-scoped DI.
  - `UIPanel` resolves its layer through `SceneRenderTreeKey` (scene-scoped) instead of the removed `UILayerManagerKey`.

- Updated dependencies [[`233aed2`](https://github.com/marco-lepore/yage/commit/233aed24dcd68e020a20a030d13668224ce22c4b), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`7c0ced1`](https://github.com/marco-lepore/yage/commit/7c0ced138305b55473b98bf3302ff6a21e8860df), [`fc717ba`](https://github.com/marco-lepore/yage/commit/fc717bac2bc530a2c396da604d614f762d272232), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c), [`6c3f4ad`](https://github.com/marco-lepore/yage/commit/6c3f4adfecf1d56710fa9a1e7da5826c2fee714c)]:
  - @yagejs/renderer@0.2.0
  - @yagejs/core@0.2.0
