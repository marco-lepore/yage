---
"@yagejs/core": minor
---

Errors thrown inside code the engine calls on your behalf — event listeners, collision handlers, process callbacks, a system or component's own `update()`, scene lifecycle hooks — are now attributed to the culprit instead of surfacing from wherever the throw happened to reach: the engine reports it with its stack, then rethrows.

- `System`/`Component` update failures, and every developer callback the engine invokes (event handlers, collision/trigger handlers, input listeners, process callbacks, audio unlock callbacks), are recorded and logged through `Logger` with the original `Error`, then rethrown. Nothing is disabled, unsubscribed, muted, or cancelled.
- `GameLoop.tick()` is the one place that decides a failure is terminal: an error that escapes an entire frame unhandled stops the loop and rethrows, so it reaches your own `try`/`catch`, `window.onerror`, or an unhandled-rejection handler. An error your own code catches inside the frame — around `entity.emit(...)`, for instance — leaves the loop running.
- Scene lifecycle hooks (`onEnter`, `onExit`, `onPause`, `onResume`, plugin `beforeEnter`) are reported the same way, and a synchronous throw is rethrown — a half-built scene must not look like it mounted cleanly. An async hook's rejection can only be reported: the call has already returned by the time it settles.
- `Logger` prints every accepted entry through `console.*` by default in dev builds, so `logger.error` calls (including the ones above) are visible without configuring an `output` sink. The default drops out of a production build; passing your own `output` always overrides it. A throwing `output` sink is caught, logged once, and disabled for the rest of the session instead of escaping into whatever it was trying to report.
- `Inspector.getErrors()` returns a `callbackErrors` array — a bounded history (the 200 most recent failures) with each entry's kind and owning entity/scene/event where known.
