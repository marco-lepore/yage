---
"@yagejs-addons/dialogue": minor
---

A speaker's id is now the `speakers` map key. `SpeakerDef` drops its `id` field, so authored entries no longer repeat the key (`gwen: { name: "Gwen" }` instead of `gwen: { id: "gwen", name: "Gwen" }`). The loader derives the id from the key, making a key/id mismatch impossible to write.
