---
"@yagejs/ui": minor
---

UI elements report their destruction, and a floating slot takes a UI element as its content.

- `UIElement.onDestroy(fn)` calls `fn` once when the element is destroyed and returns a function that removes the listener. `UIElementBase` implements it. Breaking: a class implementing `UIElement` directly must add `onDestroy`.
- `FloatingHandle.setContent(element)` shows a `UIElement` in the slot, lays it out shrink-to-content, destroys a replaced element, and destroys the current one on `release()`.
