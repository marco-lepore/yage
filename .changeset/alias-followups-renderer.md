---
"@yagejs/renderer": patch
---

Close the raw `pixi.js` type positions that survived the type-alias sweep.

- New `DestroyOptions` alias in the public type vocabulary (exported from
  the barrel) — the visual components' protected `destroyOptions()` hook no
  longer names a raw `pixi.js` type in the public `.d.ts`.
