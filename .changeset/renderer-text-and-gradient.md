---
"@yagejs/renderer": minor
---

Add `TextComponent` and gradient fill helpers so user code no longer needs to import `Text` or `FillGradient` from `pixi.js`.

- `TextComponent` — layer-aware, Transform-synced, serializable text, analogous to `SpriteComponent` / `GraphicsComponent`. Constructor takes `{ text, style?, anchor?, layer?, visible?, tint?, alpha? }`; `style` forwards to PixiJS `TextStyle` (CSS-like font properties). Use for world-space labels, floating damage numbers, and HUD text. Style options are cached on the component so `serialize()` emits a JSON-safe POJO rather than the live pixi `TextStyle` instance.
- `linearGradient(...)` / `radialGradient(...)` — factory functions returning a `GradientFill` (pixi `FillGradient` under the hood) usable anywhere `g.fill(...)` accepts a fill style. Stops use yage-style numeric `color` + optional `alpha` per stop (no CSS color strings). Linear gradients support an `axis: "horizontal" | "vertical"` shorthand or explicit `start`/`end` points; radial gradients take `center`, `innerRadius`, `outerRadius`. Both default to `space: "local"` so a single instance scales across any shape it fills; pass `"global"` for absolute pixel coords.
- New public type aliases: `DisplayText`, `GradientFill`. `public-types.ts` now uses top-level `import type` per AGENTS.md.
- `examples/src/responsive-ui.ts` is rewritten — zero `pixi.js` imports remain. HUD cards now use `UIPanel` + `UIText` (`@yagejs/ui`) with `positioning: "transform"`, demonstrating the idiomatic split: laid-out text widgets are UI's job (flexbox padding, gap, background, child rows for free), while `TextComponent` and `GraphicsComponent` are the right primitives for free-positioned single-string text and procedural shapes respectively. The fog overlay uses the new `linearGradient` helper.
