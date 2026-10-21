---
"@yagejs/save": minor
---

Make every save a single atomic write and report failed automatic writes.

- `Breaking:` `listSlots` lists the store's slot documents through the adapter's `list` and reads each one, so a custom `SaveAdapter` must implement `list` as documented.
- `Breaking:` `autoPersist` reports a failed write and writes nothing to the console. `save.flush()` rejects while the latest automatic write of a store has failed, and a failure nothing awaits is an unhandled promise rejection, which ends a Node process that does not handle that event.
- `Breaking:` every `Save` method refuses a store id or slot name that makes a storage key longer than 96 bytes, on every adapter, with an `InvalidKeyError` naming both before the adapter is called. The key holds them URI-encoded: with store id `saves`, a slot name holds 88 ASCII letters or 9 Japanese characters.
- Each slot is one document holding its time and metadata, so `saveSlot` and `deleteSlot` are one storage operation each. A store saved by an earlier version is merged into slot documents the first time `listSlots`, `saveSlot` or `deleteSlot` touches it. Operations on one slot take effect in call order, awaited or not, also while that merge runs.
- `listSlots` returns slots newest first and leaves out a slot whose document is damaged; `loadSlot` reports it.
- `restore` and `loadSlot` throw `CorruptPayloadError` for stored bytes that are not JSON.
- `autoPersist` throws `InvalidKeyError` at the call for an empty or over-long store id.
- New `fileAdapter({ store })` and `SaveFileStore`: atomic per-key writes over any directory of files, with keys of at most 96 bytes.
- `SaveAdapter` documents the guarantees every adapter gives: atomic replace per key, completion, order per key, and failure. `memoryAdapter` keeps nothing through a process kill, and `localStorageAdapter` can lose its last resolved writes.
