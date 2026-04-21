---
"@yagejs/ui-react": minor
---

Add `UIRootOptions.positioning` — mirrors the `@yagejs/ui` `UIPanel` change.

- `positioning: "anchor"` (default) — `anchor` resolves against the viewport.
- `positioning: "transform"` — the React tree is pinned to `entity.get(Transform).worldPosition` in the target layer's local coord space; `anchor` is the pivot on the rendered tree. Throws at add time if the entity has no `Transform`.

Pair `positioning: "transform"` with `ScreenFollow` from `@yagejs/renderer` for entity-anchored React UI (nameplates, health bars, damage numbers) that stays axis-aligned and constant-size under any camera transform.
