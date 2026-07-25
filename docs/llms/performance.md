# Performance

Notes for keeping the frame loop cheap: which APIs allocate, where per-frame
garbage comes from, and the cost of debug mode. There is no global performance
switch — cost comes from per-call allocation and from instrumentation you leave
on.

## Allocation-aware APIs

Some calls allocate a new object every time. In hot paths (per-entity,
per-frame), call them once and reuse the result.

- **`Vec2` is immutable.** Every operation (`add`, `scale`, `normalize`, …)
  returns a new `Vec2`. Chaining several per entity per frame allocates several
  per entity per frame. Cache the result, or work in scalars in the tightest
  loops.
- **`RigidBodyComponent.getVelocity()` builds a new `Vec2` each call.** Read it
  once per frame and reuse the value.
- **Query iteration.** Iterate a `QueryResult` directly (`for (const e of
  query)`). `query.toArray()` allocates a fresh array snapshot on every call —
  use it when you need a stable list, not in the loop body.

## Effects cost

Screen-space filters from `@yagejs/effects` run every frame on the GPU. Attach an
effect at the narrowest scope that covers what you need — a content layer such as
`tree.get("world").fx`, not the whole scene — so you neither pay for pixels you
don't want processed nor post-process the HUD. See the effects doc for scope
options.

## Debug mode cost

`debug: true` installs the Inspector and adds per-frame instrumentation
(snapshots, event recording when the event log is used, extra bookkeeping). Keep
it on while developing. Turn it off for production builds and when profiling, so
a measurement reflects the game and not the tooling.

## Pooling

Short-lived, high-churn objects — bullets, one-shot particle bursts, damage
popups — are the main source of per-frame garbage: each creates and discards
entities, physics bodies, graphics, and event records. Some of the engine
already recycles: particle emitters reuse their particles internally, and the
debug overlay pools its `Graphics` and `Text`.

For your own short-lived objects, reuse a small set of entities instead of
creating and destroying them every frame. `entity.setActive(false)` turns an
entity off — hidden, physics body disabled, out of every query, components
stopped — while keeping the Rapier body, the Pixi display object, and the
component instances allocated:

```ts
// Recycling a bullet: no spawn, no destroy queue, no reallocation.
bullet.setActive(false);

// ...on the next shot. Reposition through the body, not the Transform:
// physics owns a dynamic body's transform and overwrites a direct write.
const rb = bullet.get(RigidBodyComponent);
rb.setPosition(muzzleX, muzzleY);
rb.setVelocity({ x: dirX * 900, y: dirY * 900 });
bullet.setActive(true);
```

Reactivation does not reset game state. `timeScale`, animation position,
process progress, and entity event listeners all survive — processes pause
while the entity sleeps and resume where they left off. Reset what the new life
needs yourself. Components that own a live resource get `onEnable()` /
`onDisable()` to release and reacquire it; see the core package reference.
