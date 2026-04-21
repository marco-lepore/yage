---
"@yagejs/ui-react": minor
---

Add `UIRootOptions.positioning` — mirrors the `@yagejs/ui` `UIPanel` change.

- `positioning: "anchor"` (default) — `anchor` resolves against the viewport.
- `positioning: "transform"` — the React tree is pinned to `entity.get(Transform).worldPosition` in the target layer's local coord space; `anchor` is the pivot on the rendered tree. Throws at add time if the entity has no `Transform`.

Pair `positioning: "transform"` with `ScreenFollow` from `@yagejs/renderer` for entity-anchored React UI (nameplates, health bars, damage numbers) that stays axis-aligned and constant-size under any camera transform.

**Breaking:** `@yagejs/ui-react` now ships a `UIReactPlugin` that must be registered alongside `UIPlugin` (`engine.use(new UIReactPlugin())`). It installs a `LateUpdate`-phase layout system so `UIRoot` positioning runs after Update-phase Transform writers — the same phase ordering `UIPanel` has always had. Previously `UIRoot` laid out inside `Component.update()` (Phase.Update), which was a latent race with any Update-phase Transform writer. `UIRoot.onAdd()` now throws a clear error if the plugin is missing, so forgetting to register it is no longer a silent failure.
