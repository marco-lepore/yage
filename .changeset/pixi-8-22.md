---
"@yagejs/ui": minor
"@yagejs/ui-react": minor
"@yagejs/particles": minor
"@yagejs/tilemap": minor
"@yagejs/debug": minor
"@yagejs/effects": minor
"@yagejs-tools/editor": minor
---

Raise the PixiJS peer floor from `^8.8.0` to `^8.22.0`.

**Breaking:** a game on PixiJS 8.8 to 8.21 must upgrade to 8.22 or newer.

Pixi 8.21.0 throws when nested filters draw after the renderer resizes, and 8.16.0 to 8.17.1 corrupt filters and render textures on iOS 18.0 and 18.1.
