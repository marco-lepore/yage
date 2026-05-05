---
"@yagejs/ui-react": patch
---

pr: 55
commit: e4d882380e37a02c8fd259c5019c576a46f9aa89
author: marco-lepore

Typed reactive stores in core + a new Save IO instance built on them; snapshot system renamed to free the `Save*` namespace.

- `Store` and `createStore` now re-export from `@yagejs/core`'s state module — single source of truth for the reactive store primitive.
- `useStore` works unchanged on the new persistent stores from core (`defineStore` / `defineSet` / `defineMap` / `defineCounter`).
