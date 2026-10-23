---
"@yagejs-addons/virtual-controls": patch
---

The default stick and button views set visibility and opacity through their visual components, so a hidden or dimmed control keeps that state when its entity is re-activated or a visual modifier changes.
