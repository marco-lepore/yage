---
"@yagejs-addons/dialogue": patch
---

The default presenters add their layers through the render tree of the scene they mount on (`SceneRenderTreeKey`). They do not resolve the tools-only `SceneRenderTreeProviderKey`.
