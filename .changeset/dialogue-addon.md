---
"@yagejs-addons/dialogue": minor
---

Add `@yagejs-addons/dialogue`, the first YAGE addon: a self-contained, themeable dialogue system.

- **Headless core** (root entry `.`): runner/session/types, markup parser, i18n, canonical format, `DialogueController`, events, and pixi-free input bindings over `@yagejs/input`. The root entry never transitively imports `pixi.js` or `@yagejs/renderer`.
- **Presenters** (`./presenters` subpath): all pixi-backed rendering — Graphics chrome + canvas `SplitText`/`Text` views, avatars, composites, and factories. Zero bundled assets.
- **Zero-config `defaultTheme()`**: Graphics chrome + canvas font with native bold/italic and per-glyph effects. Bitmap fonts are an opt-in theme path.
- **Opt-in nine-slice `TexturedChrome` / `TexturedBubble`** for texture-driven re-theming, implemented with Pixi `NineSliceSprite` (no `@yagejs/ui` dependency).
- **Glossary terms**: `[term]`/`[gloss]` markup, underlined and hover-highlighted so they read as interactable. Hover/tap routing is the pointer binding's single responsibility (`setTermSink`) — it owns hit-testing and suppresses the line advance, so a tap on a term opens its tooltip without turning the page (the game owns the tooltip).
- **Content-sized speech bubbles**: `BubbleChrome` grows to fit its wrapped text (via the renderer's `measureWrappedText`) instead of clipping at a fixed height.
- **VN controls**: session-level auto-advance (`setAutoAdvance(ms | null)`) and a hold-to-confirm skip (`fullControls(choices, { skipHoldMs })`), on top of the existing hold-to-fast-forward.
- **Opt-in `@experimental` radial choice presenter** under `./presenters`.

Independently versioned (not part of the `@yagejs/*` fixed group). Ships ESM + CJS with type declarations for both entry points.
