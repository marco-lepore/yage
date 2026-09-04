---
"@yagejs/renderer": patch
---

`texture(path, { scaleMode })` sets how one image is sampled.

`texture("tiles.png", { scaleMode: "nearest" })` loads that sheet with
nearest-neighbour sampling, for pixel art in a project that is otherwise
smooth; `pixelArtPreset` remains the switch for a whole project. The setting
applies to the loaded image, so every sprite drawing from it samples the same
way.
