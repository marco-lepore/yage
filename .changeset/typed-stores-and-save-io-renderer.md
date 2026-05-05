---
"@yagejs/renderer": patch
---

pr: 55
commit: e4d882380e37a02c8fd259c5019c576a46f9aa89
author: marco-lepore

Typed reactive stores in core + a new Save IO instance built on them; snapshot system renamed to free the `Save*` namespace.

- `RendererPlugin`'s optional snapshot bridge now resolves the renamed `SnapshotServiceKey` (peer-dep dynamic import), tracking the rename in `@yagejs/save`.
