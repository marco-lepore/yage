---
"@yagejs-addons/dialogue": minor
---

Add `createRecordStorage(record)` — a `VariableStorage` over a plain mutable `Record<string, string | number | boolean>` you already own, with no null guard to write by hand. The runtime can write `null` to a storage (from a literal `null` in a `set` directive and from reading an absent variable); by convention `null` means unset, so `createRecordStorage` deletes the key on a `null` write and the backing record stays typed non-null. Documents this null contract on the `VariableStorage.set` JSDoc.
