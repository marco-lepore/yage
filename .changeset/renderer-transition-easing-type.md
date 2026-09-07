---
"@yagejs/renderer": patch
---

`slidePush` and `irisReveal` type their `easing` option as `EasingFunction` and
take their defaults from `@yagejs/core`'s published easings (`easeOutCubic` and
`easeLinear`). The curves are unchanged and the type is structurally identical
to the inline signature it replaces, so no call site changes; naming the type
is what points a reader from a transition's options to the easing table.
