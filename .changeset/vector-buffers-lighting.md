---
"@yagejs/lighting": patch
---

Add caller-owned vector buffers and coordinate reads without Vec2 construction.

- Add `getPositionInto` to light sources and occluders.
- Reuse coordinate buffers in light-level queries and overlay camera projection.
