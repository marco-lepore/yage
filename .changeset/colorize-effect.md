---
"@yagejs/effects": minor
---

New `colorize` preset — luminance-to-colour recolour via a custom WebGL+WGSL shader pair. Outputs `mix(sourceRGB, tintColor * L, strength)` where `L` is Rec. 601 luminance, so black stays black, white reaches the target colour, midtones blend proportionally, and source alpha is preserved unchanged. The replace-style alternative to `sprite.tint`'s multiply, which turns saturated source colours into mud when the tint is far from the source hue. Options: `{ color: number | string, strength?: number }` (default `strength: 1`); handle: `setColor(color: number | string)`, `setStrength(value: number)` (preserves intensity ratio), plus the base fade/run/setEnabled/remove surface.
