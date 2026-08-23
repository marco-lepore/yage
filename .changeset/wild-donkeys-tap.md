---
"@yagejs/core": patch
---

Add `window.__yage__.ready` and `inspector.drive(fn)` for driving a running game

An engine built with `debug: true` now publishes `window.__yage__` as `start()`
begins, and the object carries a `ready` promise that settles when `start()`
finishes — plugins installed, loop running, `onStart` hooks done. A driver that
reloads the page awaits `ready` instead of guessing a sleep, and a boot failure
rejects it with the error that stopped startup rather than leaving a poller to
time out. The first scene is pushed by the host after `await engine.start()`, so
waiting for a scene stays a separate step.

`inspector.drive(fn)` runs a callback with the clock held still and reports the
outcome as one object:

```ts
const run = await inspector.drive(async ({ input, until }) => {
  input.keyDown("KeyD");
  return await until(() => inspector.getEntityPosition("player").x > 950, {
    maxFrames: 240,
  });
});
// { ok: true, value: 137, framesUsed: 137, durationMs, captures: [] }
```

The context carries `step`, `until`, `input`, `events` and `capture`. Every
frame-advancing call is awaitable and drains async work between frames, so a
sequence crossing a scene transition advances instead of stalling — including
`input.tap`, `input.hold` and `input.fireAction`, whose `inspector.input`
versions are synchronous and do not. The clock is frozen for the duration and
returned to the state it was in, and synthetic input is released afterwards, so
a drive leaves no key held. A throw inside the callback comes back as
`{ ok: false, error }`; a missing `DebugPlugin` throws from the `drive()` call.

The context is shaped like `@yagejs-tools/lab`'s scenario `drive`, so a probe
worth keeping moves into a scenario file with little edited — assert with the
lab's `expect` instead of returning a measurement, since a scenario's `drive`
returns `void`, and note that `fireAction` pulses the action once per frame
here where the lab holds it down for the whole span.
