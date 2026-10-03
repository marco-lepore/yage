---
"@yagejs/renderer": minor
---

Inherit UI input consumption through the display tree.

Resolve UI pointer and wheel consumption from the nearest explicit boolean on the hit path. A nearer `false` overrides a consuming ancestor. Inheriting UI defaults to consuming when no explicit ancestor exists; ordinary unregistered display objects do not consume.
