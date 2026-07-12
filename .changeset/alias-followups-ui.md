---
"@yagejs/ui": patch
---

Close the raw `pixi.js` type positions that survived the type-alias sweep.

- Internal type positions (`floating.ts`'s overlay entries and layer,
  `UIImage`/`UINineSlice`'s texture handles) now use the renderer aliases;
  every remaining `pixi.js` import in the package is a value import for
  constructing Pixi objects. No public API or behavior change.
