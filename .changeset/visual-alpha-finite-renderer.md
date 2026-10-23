---
"@yagejs/renderer": patch
---

Setting `alpha` on a visual component, or passing the `alpha` option, throws on a non-finite value, naming the component class. The previous alpha stays in place.
