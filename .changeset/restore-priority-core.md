---
"@yagejs/core": minor
---

Snapshot restore order is now driven by a `restorePriority` static on each component class.

- New `Component.restorePriority` static: on load, an entity's components are re-added in ascending priority (undeclared = 100, engine components reserve 0-99), so a component whose `onAdd()` reads a sibling can rely on lower-priority siblings being present. Subclasses inherit the base class's value unless they declare their own.
- `Transform` declares priority 0 — it restores before every other component.
