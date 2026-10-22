---
"@yagejs-addons/hotbar": minor
---

Add hotbars for abilities, consumables and game actions.

- Bind typed action IDs to slots. Each binding reads availability, rejection reasons, quantities and cooldowns from the owner of the action.
- Bind an `Abilities` component or an `Inventory` item action with `hotbarAbility()` and `hotbarItem()`, with no package dependency on either addon.
- Hold a slot's key or press it with a mouse or finger for actions such as charged abilities. Letting go calls the binding's `release()`.
- Turn on drag-to-swap for an edit mode, at setup or while the game runs, to rearrange slots by dragging.
- Assign, clear, swap, save and restore slot layouts through the headless model. A restore leaves unknown or out-of-range entries empty and reports them.
- Use the controller's keyboard, gamepad, mouse and touch controls, customize the default view with a partial theme, or supply a presenter. The view stays on screen when the entity that owns the bar moves.
- Inspect assignments and activation outcomes through the Inspector and entity events.
