---
"@yagejs/core": minor
---

Fixes a `useQuery` leak in `@yagejs/ui-react`: every mounted component registered a live query in the engine-wide `QueryCache` with no way to release it.

- `QueryCache` gains `unregister(result)` to stop a registered query from receiving further `onComponentAdded`/`onComponentRemoved` updates. A second call (or a result that was never registered) is a no-op. Queries registered once at system-install time (`DisplaySystem`, `UILayoutSystem`) are engine-lifetime by design and are unaffected.
