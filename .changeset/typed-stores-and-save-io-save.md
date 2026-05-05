---
"@yagejs/save": minor
---

pr: 55
commit: e4d882380e37a02c8fd259c5019c576a46f9aa89
author: marco-lepore

Typed reactive stores in core + a new Save IO instance built on them; snapshot system renamed to free the `Save*` namespace.

- **Breaking**: snapshot system renamed to the `Snapshot*` prefix to free `Save*` for the new persistence path. `SaveService` → `SnapshotService`, `SavePlugin` → `SnapshotPlugin`, `SaveServiceKey` → `SnapshotServiceKey`, `SaveStorage` → `SnapshotStorage`, `LocalStorageSaveStorage` → `LocalStorageSnapshotStorage`. Plugin name changes from `"save"` to `"snapshot"`. Sources moved under `src/snapshot/`. `SNAPSHOT_VERSION` is unchanged (still 4) — no on-disk format changes. Pre-1.0; no compat aliases.
- New `Save` IO instance via `createSave({ adapter })`: `persist` / `restore` / `restoreAll` for unslotted documents; `saveSlot<M>` / `loadSlot` / `listSlots<M>` / `deleteSlot` for slotted writes with typed metadata; `autoPersist` for microtask-coalesced background writes (works outside the engine loop).
- New `SavePlugin` is a thin DI bridge that registers a user-constructed `Save` instance under `SaveServiceKey` for component access — no global mutable state.
- Adapters: `localStorageAdapter` (browser default), `memoryAdapter` (tests + Node). Slot manifests live at `${id}:__slots__` for fast metadata listing; non-atomic-write trade-off documented inline.
- New errors: `SlotNotFoundError`, `DocumentNotFoundError`. Cooperates with core's `StoreVersionTooNewError` / `StoreMigrationMissingError`.
- Re-exports core store primitives (`defineStore` et al.) so users can pull them from `@yagejs/save` when they prefer to think of them as a save concern.
