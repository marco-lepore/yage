---
"@yagejs-addons/dialogue": minor
---

Add `@yagejs-addons/dialogue`, the first YAGE addon: a self-contained, themeable dialogue system.

- **Headless core** (root entry `.`): runner/session/types, markup parser, i18n, canonical format, `DialogueController`, events, and pixi-free input bindings over `@yagejs/input`. The root entry never transitively imports `pixi.js` or `@yagejs/renderer`.
- **Presenters** (`./presenters` subpath): all pixi-backed rendering — Graphics chrome + canvas `SplitText`/`Text` views, avatars, composites, and factories. Zero bundled assets.
- **Zero-config `defaultTheme()`**: Graphics chrome + canvas font with native bold/italic and per-glyph effects. Bitmap fonts are an opt-in theme path.
- **Opt-in nine-slice `TexturedChrome` / `TexturedBubble`** for texture-driven re-theming, implemented with Pixi `NineSliceSprite` (no `@yagejs/ui` dependency).
- **Content-sized speech bubbles**: `BubbleChrome` grows to fit its wrapped text (via the renderer's `measureWrappedText`) instead of clipping at a fixed height — for bitmap fonts too, which size through the same width-first wrap-aware path as canvas text.
- **VN controls**: session-level auto-advance (`setAutoAdvance(ms | null)`) and a hold-to-confirm skip (`fullControls(choices, { skipHoldMs })`), on top of the existing hold-to-fast-forward.
- **Grapheme-correct reveal**: every character count (run lengths, `[pause]` offsets, per-glyph styles, `charsPerSec`) is in graphemes via `Intl.Segmenter` — the same segmentation pixi's `SplitText` renders one glyph per — so emoji, ZWJ sequences, and combining marks stay aligned during the typewriter reveal. `splitGraphemes()` is exported from the root entry.
- **Opt-in `@experimental` radial choice presenter** under `./presenters`.

Independently versioned (not part of the `@yagejs/*` fixed group). Ships ESM + CJS with type declarations for both entry points.
