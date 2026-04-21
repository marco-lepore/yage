---
"@yagejs/ui": minor
---

Add `UIPanelOptions.positioning` for Transform-driven panel positioning.

- `positioning: "anchor"` (default) — unchanged; `anchor` resolves against the viewport (`virtualSize`). Existing HUDs and menus keep working as-is.
- `positioning: "transform"` — panel is positioned at `entity.get(Transform).worldPosition` in the target layer's local coord space; `anchor` is reinterpreted as the pivot on the panel itself (e.g. `Anchor.BottomCenter` → panel's bottom-center sits at the Transform). Throws at add time if the entity has no `Transform`.

The option is orthogonal to the layer's `space`, which lets two patterns fall out:

- **Screen-space layer + `positioning: "transform"`** — pair with `ScreenFollow` from `@yagejs/renderer` (writes `cam.worldToScreen(target + offset)` to the Transform each frame) for entity-anchored UI that stays axis-aligned and constant-size under camera zoom / rotation. The new `world-ui` example demonstrates this with nameplates and health bars.
- **World-space layer + `positioning: "transform"`** — for genuinely diegetic UI (signs in the world, in-game displays) that scales and rotates with the camera like any other world object.

Also exports a new `pivotOffsetFromAnchor(anchor, pw, ph)` helper alongside `resolveAnchor`, and the `UIPositioning` type.
