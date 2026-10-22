---
"@yagejs/input": patch
---

Notify gesture adapters when input is reset.

- Add `InputManager.onReset()` so an input adapter that tracks its own held gestures or pending presses can discard them when `clearAll()` runs.
- Dispatch reset listeners through the existing error boundary; a throwing listener stops later listeners.
