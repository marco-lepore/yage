---
"@yagejs/input": minor
---

Notify gesture adapters when input is reset.

- Add `InputManager.onReset()` so consumers can discard held gestures and pending presses after `clearAll()` without losing taps between physics steps.
- Dispatch reset listeners through the existing error boundary; a throwing listener stops later listeners.
