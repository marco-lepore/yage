---
"@yagejs/save": minor
---

Snapshot restore order is now driven by a `restorePriority` static on each component class.

- `SnapshotService` sorts each entity's component snapshots by the `restorePriority` declared on the registered class (undeclared = 100) instead of a hardcoded list of engine component names. Equal priorities restore in save-time add order; game and addon components can now participate in ordering by declaring the static.
