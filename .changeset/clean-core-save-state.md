---
"@yagejs/core": minor
---

Remove the `@serializable` decorator, runtime type registry, restore priorities,
and ECS snapshot hooks. `Serializable<TEncoded>` remains available for explicit
save roots and reactive state.

Inspector component state now clones field by field, so a value that cannot be
JSON-cloned (an array of pixi display objects, say) drops just that field
instead of blanking the whole component's reported state.
