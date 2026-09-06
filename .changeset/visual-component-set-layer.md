---
"@yagejs/renderer": patch
---

`VisualComponent.setLayer(name)` moves a visual to another render layer.

- The render object is detached and re-parented through the same resolution the
  initial add uses, so a `SortGroupComponent` on the new layer claims it. Called
  before the component reaches an entity, it records the name and moves nothing.
- The visual joins its new parent last, which on a layer with no `sort` means it
  draws in front of everything already there.
- `layerName` is now a getter over the same value; it was a readonly field.
