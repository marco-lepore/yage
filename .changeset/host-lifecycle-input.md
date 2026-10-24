---
"@yagejs/input": patch
---

Follow one host state for application activity, visibility and focus.

- Held keyboard, gamepad and pointer input is released when the host reports the app inactive, as it is when the window loses focus or the page is hidden. All three states come from `Host`.
