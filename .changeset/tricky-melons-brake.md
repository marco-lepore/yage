---
"@yagejs-addons/dialogue": minor
---

Add `createStoreStorage(leaf)` — a `VariableStorage` backed by a `@yagejs/core` reactive store leaf, so dialogue variables can live in the game store. It accepts an open-ended record leaf or map leaf, reads through `leaf.get()` on every access, and writes through `leaf.set()` / `leaf.delete()`, so the variables survive `hydrate`/`reset` and a dialogue write that changes a value notifies the leaf's subscribers (`useStore`, `autoPersist`, the compound store's serialization). `set(name, null)` unsets the name on both leaf kinds; a fixed-shape record leaf, where that would drop a required key, is a compile error.

`createRecordStorage` is unchanged and still recommended for a plain host-owned record, but its docs no longer suggest passing a store leaf's snapshot object: a leaf replaces that object on every `set`, `hydrate`, and `reset`, so the storage would keep writing to a discarded object and silently lose every write.

Engine peer ranges move to `>=0.10.4 <0.11.0` — the record-leaf path needs `ReactiveRecord.delete`, which ships in `@yagejs/core` 0.10.4.
