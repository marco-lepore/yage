---
"@yagejs/ui": minor
"@yagejs/ui-react": minor
---

Declarative scrollable lists via `<ScrollView>` / `ScrollViewNode`; removed `PixiScrollBox`.

- New `ScrollViewNode` (`@yagejs/ui`) — a true `UIContainerElement` clipped, scrollable viewport. Children are first-class Yoga nodes laid out by the existing pass (the scrollable content is a composed `PanelNode`), so it works identically three ways: the React reconciler (`<ScrollView>` in `@yagejs/ui-react`), the `PanelNode` / `UIPanel` `.scrollView(opts)` builder, and direct `addElement`. Wheel + drag are wired through pixi federated events on the node itself (no DI / `useEngine` coupling). Public `scrollBy()` / `scrollTo()` / `scrollOffset` / `maxScroll` for programmatic control. Imperative options (`ScrollViewProps` / `ScrollViewNode` / `.scrollView()`): `direction`, `gap`, `padding`, `scrollbar`, `background`, `onScroll` plus `LayoutProps` (`width` / `height` / `flexGrow` size the viewport). In `@yagejs/ui-react`, `<ScrollView>` takes the same props but uses the shorthand `bg` (not `background`) for the background, matching `<Panel>`.
- Scroll position is preserved across re-renders for free: the reconciler keeps the node instance stable and only diffs children, so the offset (an instance field) survives store-driven updates and is re-clamped when the list shrinks.
- **Removed** `PixiScrollBox`, `<PixiScrollBox>`, and `PixiScrollBoxProps`. The `@pixi/ui` ScrollBox wrapper was append-only and a Yoga leaf — it silently dropped JSX children. `<ScrollView>` replaces it as the single scroll primitive. `PixiSelect` is unaffected (it wraps `@pixi/ui` `Select` directly).
- The reconciler now emits a one-shot dev-mode `console.warn` (via `@yagejs/core` `devWarn`) when JSX children are appended to a layout-leaf element that has no `addElement()`, turning the previously silent "why is my box empty?" failure into an actionable message.
