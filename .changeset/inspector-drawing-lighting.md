---
"@yagejs/lighting": patch
---

Control drawing during automated play.

Keep both the light buffer and bounced-light pass pending during suppressed drawing, including while the source is hidden, so captures show current lighting.
