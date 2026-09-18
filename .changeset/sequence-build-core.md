---
"@yagejs/core": minor
---

`Sequence.build()` is the one way to turn a sequence into a process.

- `build()` compiles the chained steps and returns the wrapping `Process`. Nothing ticks until a runner drives it: pass the process to `ProcessComponent.run`, or to the `run` of an entity, scene or global queue.
- Breaking: `build()` is the sequence's only public exit, so `sequence.start()` does not compile.
