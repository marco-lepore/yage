---
"@yagejs/renderer": patch
---

A `SplitTextComponent` given an empty string renders nothing instead of throwing. Pixi's split of an empty string produces no line containers, and the split then called `addChild` with no arguments, which threw a `TypeError` naming Pixi internals. Mounting with an empty label, and clearing a label and setting it again, both work now; the empty state leaves `chars`, `words` and `lines` empty.
