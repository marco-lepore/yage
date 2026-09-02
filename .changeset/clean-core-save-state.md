---
"@yagejs/core": minor
---

Remove the `@serializable` decorator, runtime type registry, restore priorities,
and ECS snapshot hooks. `Serializable<TEncoded>` remains available for explicit
save roots and reactive state.

Inspector component state now clones field by field: a field that cannot be
JSON-cloned drops on its own instead of blanking the whole component's
reported state, and class instances nested inside a field (an array of pixi
display objects, say) read as compact refs such as `{ _type: "Sprite" }`. It
reflects `Vec2`
fields and getters as `{ x, y }`, summarizes engine objects nested inside a
field the way the event log does (an entity reads as `{ id, name }`), skips
fields declared with `this.sibling()` / `this.service()`, and leaves
`undefined` values out. A component keeps bulk data out of its reflected state
with `static inspectExclude = ["field"]`; lists merge down the class chain.
`inspector.getEntityCount()` counts live entities without building a snapshot.
