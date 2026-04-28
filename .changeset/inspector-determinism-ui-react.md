---
"@yagejs/ui-react": minor
---

Inspector deterministic test mode and per-package serialization plumbing for `Inspector.snapshot()`.

- `UIRoot` is now `@serializable`. The component snapshots its constructor options (size, offset, layer, positioning) on construction and replays them through `fromSnapshot()` so React-rendered UI roots are captured by inspector snapshots and save slots. The reconciler also publishes element identities used by inspector UI-tree snapshots.
