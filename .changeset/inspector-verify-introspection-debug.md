---
"@yagejs/debug": minor
---

Inspector improvements for verifying games headlessly: default component introspection, awaitable stepping, stall detection, and event-log control.

- Added an `eventLog` option to `DebugPlugin` config (default `true`). Set `eventLog: false` to keep the debug overlay and stats while disabling per-event Inspector event logging.
