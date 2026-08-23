---
"@yagejs-tools/lab": patch
---

Add a frame budget and scoped key holds to the lab drive context

`__yageLab__.drive(fn, { maxFrames })` bounds an ad-hoc run: once the budget is
spent the callback is stopped and the result is `{ ok: false, timedOut: true }`.
It defaults to 10,000 frames and takes `Infinity` to disable it. A scenario's
own `drive` is unbounded, as before.

Every drive result carries `state` — the keys and actions held when the run
ended, plus the scene stack — captured before synthetic input is released.

The context gains `input.whileHolding(codes, fn)`, which holds `codes` for the
duration of `fn` and then restores what was held before, even when `fn` throws,
and `framesUsed`, a live count of the frames the run has spent:

```ts
await ctx.input.whileHolding(["KeyD"], async () => {
  while (ctx.framesUsed < 900 && !atExit()) {
    if (ground.grounded && gapAhead(body, 48)) { await jumpGap(ctx); continue; }
    await ctx.step(1);
  }
});
```

Nesting `whileHolding` layers holds by scope even when the code sets overlap:
a code already down on entry is left alone at both ends, so an inner maneuver
adds keys without dropping the ones already held.
