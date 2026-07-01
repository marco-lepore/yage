---
"@yagejs/core": minor
---

`createList` / `s.list` accept an optional `keyBy` to look up items by a domain field in O(1). With it, `ReactiveList` exposes `findId(key)`, `getByKey(key)`, and `upsert(key, item)` — useful for inventories or registries keyed by something like an `itemId`. The key index is derived, so existing saves load unchanged.
