---
"@yagejs/save": minor
---

Make every save a single atomic write and report failed automatic writes.

- `Breaking:` `listSlots` lists the store's slot documents through the adapter's `list` and reads each one, so a custom `SaveAdapter` must implement `list` as documented.
- `Breaking:` `autoPersist` reports a failed write and writes nothing to the console. `save.flush()` rejects while the latest automatic write of a store has failed, and a failure nothing awaits is an unhandled promise rejection, which ends a Node process that does not handle that event.
- Each slot is one document holding its time and metadata, so `saveSlot` and `deleteSlot` are one storage operation each. A store saved by an earlier version is merged into slot documents the first time `listSlots`, `saveSlot` or `deleteSlot` touches it.
- `listSlots` returns slots newest first and leaves out a slot whose document is damaged; `loadSlot` reports it.
- `restore` and `loadSlot` throw `CorruptPayloadError` for stored bytes that are not JSON.
- `autoPersist` throws `InvalidKeyError` at the call for an empty store id.
- New `fileAdapter({ store })` and `SaveFileStore`: atomic per-key writes over any directory of files, with keys of at most 96 bytes.
- `SaveAdapter` documents the guarantees every adapter gives: atomic replace per key, completion, order per key, and failure.
