---
"@yagejs/renderer": minor
---

A custom scene transition changes each scene through its `SceneRenderTree` and covers the swap with a transition overlay, without a Pixi object.

- `SceneRenderTree` has `alpha`, `visible` and `setOffset(x, y)` with a matching `offset`, in virtual pixels. All three apply to the scene's world, screen and canvas layers, and a held offset keeps the canvas layers in place when the canvas resizes. A non-finite alpha or offset throws.
- `getSceneRenderTree(ctx, scene)` returns a scene's render tree inside a transition.
- `createTransitionOverlay(ctx, { coverScreen? })` returns a `TransitionOverlay`: a drawing above every scene's world and screen layers, with `area`, `draw`, `alpha`, `visible`, `setMask`, `clearMask` and `destroy`. Without `coverScreen` its `area` is in virtual pixels, the letterbox bars stay visible, and canvas layers draw above it. With `coverScreen: true` it covers the whole canvas, canvas layers included, in canvas pixels.
- `SceneRenderTree.setTransitionMask(factory)` masks a scene for a transition. The scene's own `setMask` mask is set aside, not destroyed, and comes back when the returned handle is removed, so a scene keeps its mask after `chessboard` and `irisReveal`.
- The built-in transitions use the same helpers.
- Breaking: `getSceneContainer` is removed. A transition that faded, hid or moved the Pixi root uses `getSceneRenderTree` with `alpha`, `visible` or `setOffset`, and one that added its own `Graphics` to the stage uses `createTransitionOverlay`.
- Breaking: a hand-written `SceneRenderTree`, such as a test fake, implements `alpha`, `visible`, `offset`, `setOffset` and `setTransitionMask`.
