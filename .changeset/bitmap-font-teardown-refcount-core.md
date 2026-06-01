---
"@yagejs/core": minor
---

Reference-count shared assets so a font or texture held by more than one owner survives until the last release.

- `AssetManager` now reference-counts loads by `type:path`. Every `loadAll` adds a reference — including for already-cached handles — and `unload` invokes the loader's `unload` (and drops the cache entry) only when the last reference is released; earlier calls just decrement. Two scenes preloading the same asset no longer tear it out from under each other on the first `unload`. `clear` still frees everything outright, ignoring counts. Behaviour is unchanged for an asset loaded once.
