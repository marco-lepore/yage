---
"@yagejs/audio": minor
---

Inspector deterministic test mode and per-package serialization plumbing for `Inspector.snapshot()`.

- `AudioManager` accepts a `RandomService` so `playRandom(...)` is reproducible under inspector-driven seeds; `AudioPlugin` wires `globalRandom` by default.
