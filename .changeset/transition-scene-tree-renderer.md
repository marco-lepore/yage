---
"@yagejs/renderer": minor
---

A custom scene transition changes each scene through its `SceneRenderTree` and covers the swap with a transition overlay, without a Pixi object.

- `SceneRenderTree` has `alpha`, `visible` and `setOffset(x, y)` with a matching `offset`, in virtual pixels. All three apply to the scene's world, screen and canvas layers. A non-finite alpha or offset throws.
- `getSceneRenderTree(ctx, scene)` returns a scene's render tree inside a transition.
- `createTransitionOverlay(ctx, { coverScreen? })` returns a `TransitionOverlay`: a drawing above every scene with `area`, `draw`, `alpha`, `visible`, `setMask`, `clearMask` and `destroy`. Without `coverScreen` its `area` is in virtual pixels and the letterbox bars stay visible. With `coverScreen: true` it covers the whole canvas in canvas pixels.
- The built-in transitions use the same helpers.
- Breaking: `getSceneContainer` is removed. A transition that faded, hid or moved the Pixi root uses `getSceneRenderTree` with `alpha`, `visible` or `setOffset`, and one that added its own `Graphics` to the stage uses `createTransitionOverlay`.
- Breaking: a hand-written `SceneRenderTree`, such as a test fake, implements `alpha`, `visible`, `offset` and `setOffset`.
