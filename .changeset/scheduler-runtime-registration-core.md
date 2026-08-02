---
"@yagejs/core": patch
---

`SystemScheduler` owns the system registration lifecycle, so a system added at runtime is registered the same way as one added at startup.

- `add()` on a started engine sets the system's engine context and calls `onRegister` immediately. A system added through `SystemSchedulerKey` after `engine.start()` previously ran without a context, so `use()` threw inside it and its `onRegister` never fired.
- `remove()` calls `onUnregister` for a registered system, matching the documented system lifecycle.
- `Engine.destroy()` unregisters systems through the scheduler, so a plugin that removes its own systems during teardown no longer fires `onUnregister` twice.
