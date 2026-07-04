---
"@yagejs-addons/dialogue": minor
---

DialogueController's zero-config input now uses `dialogueControls()` (keyboard + pointer) so mouse/touch advance works out of the box, and it warns in dev when none of the default keyboard action names exist in the live `InputManager` action map. `KeyboardInputBinding` and `CompositeInputBinding` gain an `actionNames()` accessor exposing the action names a binding polls.
