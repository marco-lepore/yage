---
"@yagejs-addons/virtual-controls": patch
---

`setVisible` accepts `"auto"`, the same three values as the `visible` option. `"auto"` reads the device through `prefersTouchControls()`, so a settings screen offering "on / off / automatic" passes its choice straight through with no branch of its own.

Turning the overlay off still releases every engaged control, whichever value resolved to off: mirrored actions get their release edge and the synthetic axes reset.
