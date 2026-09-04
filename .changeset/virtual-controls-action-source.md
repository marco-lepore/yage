---
"@yagejs-addons/virtual-controls": minor
---

Make input lifetimes explicit and keep every edge on the shared input path.

- Own sustained button and stick actions through one `InputActionSource`, so another device's hold cannot be released by the overlay.
- Trust the input manager's UI claim before routing a touch, and keep device state independent from scene pause.
- Reject non-finite and out-of-range control geometry before it reaches the model.
