---
"@yagejs/renderer": patch
---

Fix a `linearGradient` doc comment that pointed at the removed `Component.onRemove` hook — destroy a gradient's backing texture in `onDestroy()` instead.
