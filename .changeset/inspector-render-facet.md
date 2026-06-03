---
"@yagejs/core": minor
"@yagejs/renderer": minor
---

Add a derived rendered-geometry / visibility facet to the Inspector snapshot.

- `@yagejs/core`: new exported `RenderFacetSnapshot<Extra>` (`{ bounds, visible }`, widenable per component) plus optional `render?` on `WorldEntitySnapshot` and `ComponentStateSnapshot`. The Inspector duck-types an optional `inspectRender()` method on each component (mirroring the existing UI duck-typing), tolerates an absent or throwing hook, and keeps the facet entirely out of `serialize()` — the persistence model is unchanged. `bounds` are world-space pixels measured from the geometry itself, so a sized-but-hidden object still reports its real box; `bounds` is `null` only for genuinely empty geometry (an empty `Graphics`, a zero-area object), never for a merely-hidden one — `visible` carries the hidden/shown state. The entity-level `render` mirrors the first graphical component the entity added (insertion order). No Pixi leaks into core.
- `@yagejs/renderer`: `SpriteComponent`, `AnimatedSpriteComponent`, `GraphicsComponent`, `TextComponent`, and `SplitTextComponent` now expose `inspectRender()` — a compute-on-demand, read-only method deriving the live display object's world-space bounds and visibility from `getLocalBounds()` (leaving the scene graph's cached transforms untouched). `SplitTextComponent` additionally reports per-glyph visibility (`glyphs`) and the visible substring (`visibleText`), so a typewriter reveal is observable from the public Inspector API instead of reaching into Pixi internals.
