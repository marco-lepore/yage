---
"@yagejs-addons/i18n": patch
---

Keep translated UI and dialogue consistent.

- Accept the base `UISurface.text` options on `LocalizedUISurface.text`, including layout and truncation. The optional parent panel is now the fourth argument: `text(content, style, opts, parent)`.
