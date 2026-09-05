---
"@yagejs-addons/inventory": patch
---

Clarify addon composition and lifecycle contracts.

- Create missing inventory render layers before built-in presenters draw, including standalone views, cell renderers, hints, and menu skins. Custom names use the same default screen-space orders; existing host layers retain their ordering.
