---
"@yagejs/renderer": minor
---

Add `SortGroupComponent` — render a multi-part entity as one depth unit under a layer sort.

- Under a layer `sort` (e.g. `ySort`) every visual is keyed independently, so a multi-part entity — a body plus offset child sprites, or a parent plus child entities — splits when an unrelated entity's depth key lands between its parts. `SortGroupComponent` gives the entity its own stacking context: its visuals sort among themselves inside an owned sub-container while the group sorts as a single unit against the rest of the layer (the same idea as Unity's `SortingGroup`).
- The group sorts at the owning entity's own sprite (so `ySort` / `ySortBy` read a real position and offset), falling back to its `Transform` position when the entity renders nothing itself. Members keep insertion order and honour a manually-set `zIndex` by default; pass `innerSort` to depth-sort members among themselves. Only paint order changes — positions, rotation, and scale stay composed by the ECS `Transform`.
- Added a `renderObject` getter to `SpriteComponent`, `GraphicsComponent`, `AnimatedSpriteComponent`, `TextComponent`, and `SplitTextComponent` for uniform access to the underlying Pixi display object.
