---
"@yagejs/ui": patch
"@yagejs/ui-react": patch
"@yagejs/particles": patch
"@yagejs/tilemap": patch
"@yagejs/debug": patch
"@yagejs/effects": patch
"@yagejs-tools/editor": patch
---

Requires `pixi.js` 8.22.0 or later. Pixi 8.21.0 throws when nested filters draw after the renderer resizes, and 8.16.0 to 8.17.1 corrupt filters and render textures on iOS 18.0 and 18.1.
