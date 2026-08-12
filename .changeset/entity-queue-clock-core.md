---
"@yagejs/core": patch
---

An entity-scoped process queue picks the clock that advances the work it enqueues.

- `makeEntityScopedQueue(entity, { clock: "fixed" })` schedules every process the queue enqueues on the fixed timestep, through `ProcessFixedUpdateSystem`. The default `"frame"` keeps them on rendered-frame time, so a queue created without options is unaffected.
- The clock is read when the queue is created, so `ScopedProcessQueue.run(p)` takes none. One queue carries one clock, and processes on the other clock need a second queue with its own `cancelAll()`.
