---
"@yagejs/ui": minor
---

Unify the five visual components' options, delete the raw-texture escape
hatches, and stop leaking raw `pixi.js` types from public signatures.

- Every UI primitive's public `container` / `displayObject` field (and
  `SplitText`-related fields on `UISplitText`, `FloatingHandle.container`,
  the exported `applyConsumeInput`/`clearConsumeInput`/`PointerEvents`
  signatures) is now typed through `@yagejs/renderer`'s alias layer
  (`DisplayContainer`, `DisplaySprite`, `NineSliceSprite`,
  `DisplaySplitText`, `DisplaySplitBitmapText`, ...) instead of a raw
  `pixi.js` import. Type-only change — the values are unchanged, and every
  field still holds the real Pixi object.
