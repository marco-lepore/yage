---
"@yagejs/core": patch
---

Add `delete(key)` to the reactive record leaf, so a key can be removed rather than only overwritten. `createRecord({ ... }).delete("greeted")` drops the key from `get()` and from `serialize()`, and notifies subscribers; deleting an absent key is a no-op that fires nothing.

The key parameter accepts index-signature keys (`Record<string, T>`) and optional keys. On a fixed-shape record a required key is rejected at compile time — `get()` returns `Readonly<T>`, so removing a required key would leave the read typed but missing at runtime. `delete` is declared as a property rather than a method so it is checked contravariantly: a fixed-shape record is likewise not assignable to an open-ended `ReactiveRecord<Record<string, V>>`, which would otherwise let a `delete` through the alias drop a required key anyway.

Additive for anyone using the `createRecord` / `s.record` factories. Code that structurally implements `ReactiveRecord<T>` by hand — rather than obtaining one from a factory — needs to add the new member.
