---
"@yagejs/renderer": patch
---

Keep blur and glow margins visible as effect hosts scale.

- Include child filter padding in parent effect bounds so layer, scene, and screen effects preserve nested halos and blur.
- Leave ordinary bounds queries and local layout bounds unchanged and remove the bounds integration when the last owned effect is removed. Custom filters contribute their declared padding while sharing a host with an effect.
