---
"@yagejs/core": minor
---

pr: 55
commit: e4d882380e37a02c8fd259c5019c576a46f9aa89
author: marco-lepore

Typed reactive stores in core + a new Save IO instance built on them; snapshot system renamed to free the `Save*` namespace.

- New `core/src/state` module: `Atom<T>` (signal-shaped reactive cell), `Store<T>` (object-shaped, shallow-merge, frozen snapshots), and persistent variants `defineStore<T>` / `defineSet<K>` / `defineMap<K, V>` / `defineCounter` with id, version, migrate, codec, serialize, hydrate.
- Codec primitives: `Codec<T>`, `jsonCodec`, `setCodec`, `mapCodec`, `dateCodec`.
- Explicit migration errors: `StoreVersionTooNewError`, `StoreMigrationMissingError`.
- Internal store registry + `_resetAllStoresForTesting` / `_clearStoreRegistryForTesting` test helpers.
