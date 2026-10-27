---
"@yagejs/core": patch
---

Report what the graphics context can do, and bring YAGE's drawing back after a lost context.

- `EngineEvents` carries `graphics:context` with `{ lost: boolean }`, emitted by `RendererPlugin` when the graphics context is lost and again when it is restored.
