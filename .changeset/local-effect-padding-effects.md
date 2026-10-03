---
"@yagejs/effects": minor
---

Keep blur and glow margins visible as effect hosts scale.

- Interpret bloom blur, outline thickness, shadow offset and blur, glow distance, channel separation, motion velocity and offset, and axis blur strengths in host-local pixels. These sizes now follow camera zoom and responsive fit. Remove manual canvas-scale multiplication for these options.
- Calculate padding from current scale and sampling reach, including all Gaussian and Kawase passes. Keep glow sample distance consistent on WebGL and WebGPU as the host scales.
- Preserve configured values and fade intensity across renders and runtime setter calls. Pixelation size and CRT line width keep their existing units.
