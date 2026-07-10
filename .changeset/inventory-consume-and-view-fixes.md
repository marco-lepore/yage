---
"@yagejs-addons/inventory": patch
---

Three fixes to the inventory addon:

- `PointerInputBinding` skips clicks on consumed pointers. A tap another handler claimed via `InputManager.consumePointer` (e.g. a virtual-controls overlay) no longer also clicks the panel. The check runs at poll time, where the consume mark is still set regardless of listener registration order.
- The unsubscribe returned by a filtered view's `on("changed")` is idempotent. Before, calling it twice drove the internal listener refcount negative, permanently detaching model forwarding for every later subscriber.
- `InventoryChangedEvent` and `InventoryEvents.changed` docs state that `slots` is always empty when the source is a filtered view — a compacted projection has no stable slot indices to report. (The behavior is unchanged; the docs promised affected indices they never delivered.)
