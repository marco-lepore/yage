---
"@yagejs-addons/dialogue": minor
---

Make input lifetimes explicit and keep every edge on the shared input path.

Read dialogue taps from the input manager's current-frame pointer presses. The binding no longer owns a pointer subscription or a pointer-id latch, and choice clicks use the position captured by the press.
