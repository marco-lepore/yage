---
"@yagejs-addons/dialogue": minor
---

Domain-prefix the input and theme value exports so a game using both the dialogue and inventory addons never collides on an auto-import (both addons previously exported `fullControls`, `DEFAULT_ACTIONS`, and a generic `defaultTheme` with incompatible shapes).

- `fullControls` → `dialogueControls`
- `DEFAULT_ACTIONS` → `DEFAULT_DIALOGUE_ACTIONS`
- `FULL_ACTIONS` → `FULL_DIALOGUE_ACTIONS`
- `defaultTheme` → `defaultDialogueTheme`

The binding classes (`KeyboardInputBinding`, `PointerInputBinding`, `CompositeInputBinding`) and the `InputBinding` type keep their generic names — a wrong import there is a compile error, not a silent hazard, and identical shapes are harmless.

Migration: update imports and call sites to the new names. Behavior is unchanged; every renamed symbol fails as a type error, so stale sites can't run silently.
