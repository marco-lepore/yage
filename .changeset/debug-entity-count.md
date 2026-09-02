---
"@yagejs/debug": patch
---

The overlay's entity counter reads `inspector.getEntityCount()` instead of
building a full world snapshot every frame.
