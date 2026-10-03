---
"@yagejs/renderer": minor
---

Control drawing during automated play.

Add `drawingEnabled`, `render()` and `captureCanvas()`. Suppressed frames keep pointer transforms and stacking order current without consuming pending graphics updates. Requested render targets defer drawing until the next stage draw or capture. Set a target's `dependsOn` option to wait for its input targets before drawing.
