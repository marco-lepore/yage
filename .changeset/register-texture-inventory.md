---
"@yagejs-addons/inventory": patch
---

The icon-cell preset passes the icon key (not the resolved `Texture`) to `SpriteComponent`, matching the renderer's key-only sprite options; cell icon sprites are now serializable.
