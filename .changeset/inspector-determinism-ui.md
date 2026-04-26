---
"@yagejs/ui": minor
---

Inspector deterministic test mode and per-package serialization plumbing for `Inspector.snapshot()`.

- `UIPanel` is now `@serializable`. `LoadingSceneProgressBar` records its constructor options on setup and round-trips through `serialize()` / `fromSnapshot()` so it survives save/load and inspector snapshot diffs.
