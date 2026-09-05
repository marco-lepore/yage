---
"@yagejs/renderer": patch
---

Clarify addon composition and lifecycle contracts.

- Warn in development when `ensureLayer` requests an order different from an existing layer. Preserve the host's layer and order, and report each scene-tree, layer-name, requested-order mismatch only once.
