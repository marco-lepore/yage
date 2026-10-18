---
"@yagejs-tools/lab": patch
---

Report what the graphics context can do, and bring YAGE's drawing back after a lost context.

- The content screenshot's texture-size warning reads the limit from `renderer.capabilities`, so it is reported the same way on a WebGL and on a WebGPU context.
