---
"@yagejs-addons/dialogue": minor
---

Add `@yagejs-addons/dialogue`, the first YAGE addon: a self-contained, themeable dialogue system.

- **Headless core** (root entry `.`): runner/session/types, markup parser, i18n, canonical format, `DialogueController`, events, and pixi-free input bindings over `@yagejs/input`. The root entry never transitively imports `pixi.js` or `@yagejs/renderer`.
- **Presenters** (`./presenters` subpath): all pixi-backed rendering — Graphics chrome + canvas `SplitText`/`Text` views, avatars, composites, and factories. Zero bundled assets.
- **Zero-config `defaultTheme()`**: Graphics chrome + canvas font with native bold/italic and per-glyph effects. Bitmap fonts are an opt-in theme path.
- **Opt-in nine-slice `TexturedChrome` / `TexturedBubble`** for texture-driven re-theming, implemented with Pixi `NineSliceSprite` (no `@yagejs/ui` dependency).
- **Glossary terms**: `[term]`/`[gloss]` markup with highlight + hit-test, plus event-only pointer wiring routing hover/tap to `onTermActivate(id)` (the game owns the tooltip).
- **Opt-in `@experimental` radial choice presenter** under `./presenters`.

Independently versioned (not part of the `@yagejs/*` fixed group). Ships ESM + CJS with type declarations for both entry points.
