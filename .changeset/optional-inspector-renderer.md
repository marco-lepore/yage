---
"@yagejs/renderer": patch
---

`RendererPlugin` registers its render facet with the Inspector in `onStart` instead of `install`, so it finds an Inspector installed by a plugin registered after it, such as `DebugPlugin`.
