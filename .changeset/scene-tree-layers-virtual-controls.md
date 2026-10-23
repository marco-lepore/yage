---
"@yagejs-addons/virtual-controls": patch
---

The presenter from `createControlsPresenter()` adds its layer through the render tree of the scene it mounts on (`SceneRenderTreeKey`). It does not resolve the tools-only `SceneRenderTreeProviderKey`.
