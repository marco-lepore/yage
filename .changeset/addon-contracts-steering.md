---
"@yagejs-addons/steering": patch
---

Clarify addon composition and lifecycle contracts.

- Skip zero-time steering updates before behavior evaluation, body access, or output. Preserve velocity and heading during freezes, including with infinite acceleration and custom apply callbacks.
