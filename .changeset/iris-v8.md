---
"@yagejs/renderer": patch
---

Fix Pixi v8 deprecation warning in the `iris()` scene transition.

`iris()` was constructing `new Graphics()` and adding the mask geometry as a child — Pixi v8 logs a deprecation because `Graphics` is no longer a `Container`. The overlay is now a real `Container` that holds the color fill `Graphics` plus the mask `Graphics`, so the warning goes away while the transition renders identically.
