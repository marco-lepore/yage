---
"@yagejs/core": patch
---

Show authored collider footprints in the level editor.

- Add `Inspector.getComponentFacet(component, namespace)` to read one registered component facet without reflecting fields or building a scene snapshot. It follows the existing contributor registration and omission contracts.
