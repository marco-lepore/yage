---
"@yagejs/renderer": minor
"@yagejs/debug": minor
"@yagejs/effects": minor
"@yagejs/lighting": minor
"@yagejs/particles": minor
"@yagejs/tilemap": minor
"@yagejs/ui": minor
"@yagejs/ui-react": minor
"@yagejs-addons/dialogue": minor
"@yagejs-addons/inventory": minor
"@yagejs-addons/virtual-controls": minor
"@yagejs-tools/editor": minor
---

Raise the PixiJS peer floor from `^8.5.0` to `^8.8.0`.

**Breaking:** a game on PixiJS 8.5 to 8.7 must upgrade to 8.8 or newer.

`textureSpace`, the Graphics fill property that selects how a texture or a
gradient maps onto a shape, does not exist before PixiJS 8.8.0. Older versions
ignore it, so the `space` option on `linearGradient` and `radialGradient` has
no effect there and the gradient renders in whichever mapping that version
applies. The old floor admitted versions the engine has never supported.
