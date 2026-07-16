---
"@yagejs/renderer": minor
---

Make animated sprite playback follow scene and entity time scaling.

`AnimatedSpriteComponent` animations freeze while their scene is paused, while
`scene.timeScale` is `0`, or while the component is disabled. Other scene and
entity time-scale values compose with Pixi's `animationSpeed`.
