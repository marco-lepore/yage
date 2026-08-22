---
"@yagejs-tools/lab": patch
---

`LabApi.drive(fn, opts?)` runs a callback against the currently mounted
scenario, from `window.__yageLab__` in the browser console. `fn` gets the same
context a scenario's own `drive` receives — `step`, `until`, `input`,
`events`, `expect`, `capture` — so code tried at the console can be pasted
straight into a scenario's `drive` unchanged.

Unlike `run()`, `drive()` does not rebuild the scene first: it drives the
scene as it stands, after a `run()`, after manual play, or after a previous
`drive()` call, mutations included. Pass `{ rebuild: true }` to rebuild first,
the way `run()` does. The scenario does not need its own declared `drive`,
and a throw inside the callback — including a failed `expect` — resolves with
`ok: false` rather than rejecting the promise.

`DriveResult`'s `ok: true` branch now carries a `value` field with whatever
the driven callback returned.
