---
"@yagejs-addons/dialogue": patch
---

Clarify addon composition and lifecycle contracts.

- Create missing dialogue render layers when built-in presenters mount independently or through factories. Custom screen-layer names use the default orders; missing bubble world layers use world space at order 0. Existing host layers retain their ordering.
