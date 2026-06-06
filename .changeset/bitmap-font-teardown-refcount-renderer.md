---
"@yagejs/renderer": minor
---

Reference-count shared assets so a font or texture held by more than one owner survives until the last release.

- Add `uninstallBitmapFont(name)`, the symmetric teardown for `installBitmapFont` — it frees the baked atlas (and every emphasis variant) plus the source face. Previously an install-once bitmap font had no teardown and leaked until the page unloaded.
- Baked bitmap fonts are now reference-counted by family name, so a family shared by an `installBitmapFont` and a `webFont({ bitmap })` (or by two web-font loads) is `BitmapFont.uninstall`ed only once the last owner releases it. Unloading one `webFont` no longer wipes the atlas and variant registry out from under another consumer (review follow-up to #116).
