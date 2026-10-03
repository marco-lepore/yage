---
"@yagejs/core": minor
---

Inherit UI input consumption through the display tree.

Extend `markPointerConsumeContainer` with an explicit boolean or `"inherit"` policy. Export `PointerConsumePolicy` and `getPointerConsumePolicy` so renderers can distinguish transparent UI from an absent setting. `isPointerConsumeContainer` tests for explicit `true`; unmarking removes the setting.
