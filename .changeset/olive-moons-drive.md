---
"@yagejs/core": patch
---

Add a frame budget and scoped key holds to `inspector.drive`

`drive(fn, { maxFrames })` bounds a whole run. Once the budget is spent, the
frame-advancing calls stop the callback and the result comes back as
`{ ok: false, timedOut: true }` instead of running until a tool call gives up.
It defaults to 10,000 frames; pass `Infinity` to disable it.

Every result now carries `state` — the keys and actions held when the run
ended, plus the scene stack — read before the drive releases its synthetic
input, so a run that stalled says what it was pressing and where it was:

```ts
const run = await inspector.drive(async (ctx) => {
  await ctx.input.whileHolding(["KeyD"], async () => {
    while (ctx.framesUsed < 900 && !atExit()) await ctx.step(1);
  });
}, { maxFrames: 1200 });
// { ok: false, timedOut: true, framesUsed: 1200,
//   state: { keys: ["KeyD"], actions: [], scenes: [...] }, ... }
```

`input.whileHolding(codes, fn)` holds `codes` for the duration of `fn`, then
restores what was held before — including when `fn` throws. A code already down
on entry is left alone at both ends, so nesting layers holds by scope even when
the code sets overlap: an inner maneuver adds keys without dropping the ones
already held, which `input.clearAll()` would. `ctx.framesUsed` reports frames
spent so far, so a loop guard can bound frames rather than iterations.

`getInputState()` reads the input snapshot on its own, without the full
`snapshot()` walk over every scene and entity.
