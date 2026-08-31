---
"@yagejs/core": patch
"@yagejs-tools/lab": patch
---

Let `input.whileHolding` return its callback's value

`whileHolding(codes, fn)` typed `fn` as `() => Promise<void>`, so wrapping a
verb that reports something needed a block that threw the value away:

```ts
await ctx.input.whileHolding(["KeyS"], async () => {
  await ctx.until(() => grounded());
});
```

It is now generic over what `fn` resolves with and passes that value through,
so the direct form works and the measurement survives:

```ts
const frames = await ctx.input.whileHolding(["KeyS"], () =>
  ctx.until(() => grounded()),
);
```

Holding, release and nesting are unchanged. Existing calls keep compiling — a
callback resolving with `void` still gives a `Promise<void>`.
