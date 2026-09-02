---
"@yagejs/save": minor
---

Remove `SnapshotPlugin`, `SnapshotService`, automatic world traversal, and
snapshot storage. Controlled documents, named slots, migrations, adapters, and
`SavePlugin` remain the supported persistence API.

Fix a slot named `__proto__` saving but never appearing in `listSlots()`: the
slot manifest now uses null-prototype maps, so any slot name is an ordinary
entry.
