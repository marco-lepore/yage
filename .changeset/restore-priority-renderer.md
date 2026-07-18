---
"@yagejs/renderer": patch
---

Snapshot restore order is now driven by a `restorePriority` static on each component class.

- `VisualComponent` declares priority 30 (inherited by all visual components) and `AnimationController` declares 40, so on restore the animated sprite exists before the controller's `onAdd()` drives it.
