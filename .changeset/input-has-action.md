---
"@yagejs/input": minor
---

Add `InputManager.hasAction(name)` — whether a name is defined in the current action map. The synthetic injection methods (`fireAction` / `fireActionDown` / `setActionHeld`) throw on unknown actions; callers that bind action names from config (virtual controls, rebind UIs) can now validate up front instead of catching mid-gesture.
