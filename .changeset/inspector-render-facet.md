---
"@yagejs/core": minor
"@yagejs/renderer": minor
---

Add a derived rendered-geometry / visibility facet to the Inspector snapshot.

- `@yagejs/core`: new exported `RenderFacetSnapshot` (`{ bounds, visible, glyphs?, ... }`) plus optional `render?` on `WorldEntitySnapshot` and `ComponentStateSnapshot`. The Inspector duck-types an optional `inspectRender()` method on each component (mirroring the existing UI duck-typing), tolerates an absent or throwing hook, and keeps the facet entirely out of `serialize()` — the persistence model is unchanged. The facet shape is open (`[key: string]: unknown`) so renderer components can attach richer keys without a core change. No Pixi leaks into core.
- `@yagejs/renderer`: `SpriteComponent`, `AnimatedSpriteComponent`, `GraphicsComponent`, `TextComponent`, and `SplitTextComponent` now expose `inspectRender()` — a compute-on-demand method reading the live display object's world-space bounds and resolved visibility. `SplitTextComponent` additionally reports per-glyph visibility (`glyphs`) and the visible substring (`visibleText`), so a typewriter reveal is observable from the public Inspector API instead of reaching into Pixi internals.
