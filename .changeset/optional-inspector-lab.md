---
"@yagejs-tools/lab": patch
---

The lab installs the engine's Inspector itself before the engine starts, because the panel reads it before `DebugPlugin` installs. `LabApi` exposes it as `inspector`, which an out-of-page driver reads in place of the removed `engine.inspector`.
