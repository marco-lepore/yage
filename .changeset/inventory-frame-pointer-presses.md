---
"@yagejs-addons/inventory": minor
---

Make input lifetimes explicit and keep every edge on the shared input path.

Read inventory clicks from the input manager's current-frame pointer presses. The binding no longer owns a pointer subscription or a pointer-id latch, and slot and menu clicks use the position captured by the press.
