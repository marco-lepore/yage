---
"@yagejs/core": patch
---

`UINodeSnapshot.state` carries the element's own interaction state. An element that reports one fills the field — a button's focused, hovered, pressed and disabled flags, a checkbox's checked flag — and the field stays `null` for an element that reports none.

The Inspector reads it through an optional `_inspectState()` matched structurally, the way it already matches `yogaNode` and `displayObject`, so `@yagejs/core` keeps no dependency on `@yagejs/ui`. A test reads which element holds focus out of `inspector.snapshot()` rather than comparing pixels.
