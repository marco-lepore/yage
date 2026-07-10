---
"@yagejs-addons/dialogue": patch
---

`PointerInputBinding` skips taps on consumed pointers. A tap another handler claimed via `InputManager.consumePointer` (e.g. a virtual-controls overlay) no longer also advances the conversation or picks a choice. The check runs at poll time, where the consume mark is still set regardless of listener registration order.
