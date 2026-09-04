---
"@yagejs/ui": minor
---

UI elements now keep their documented update, input, and teardown contracts.

- Pixi UI wrappers reset removed props to their defaults, accept repeated `destroy()` calls, and apply updated select and radio items.
- Buttons and checkboxes activate only after a press starts on them. Scroll-view dragging starts after 10 px and suppresses child interaction until release.
- Container moves preserve one child entry and reject elements owned by another container before mutating local state.
- `UICheckbox` and `UISplitText` use the configured UI text defaults. Nine-slice insets and omitted texture-background values update correctly.
- Destroying a tooltip anchor disposes its tooltip. UI callbacks are attributed through the engine error boundary.
- `UIImage`, `UINineSlice`, and texture backgrounds accept renderer `TextureInput` values. The UI-specific asset-manager helpers and their exports are removed.

Breaking for pre-1.0 consumers: replace `setAssetManager` and `resolveTexture` imports from `@yagejs/ui` with renderer texture registration and `TextureInput` values.
