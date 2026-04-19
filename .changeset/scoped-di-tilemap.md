---
"@yagejs/tilemap": patch
---

pr: 20
commit: 6143e0346820dd74d78b1d345ac4ebc5e4294769
author: marco-lepore

Adopt scene-scoped DI.

- `TilemapComponent` resolves its layer through `SceneRenderTreeKey` (scene-scoped) instead of the removed `RenderLayerManagerKey`.
