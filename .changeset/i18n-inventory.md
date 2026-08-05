---
"@yagejs-addons/inventory": minor
---

Localize item names, descriptions, and action labels through the engine localization service.

Each string is looked up under a key derived from its id — `inventory.item.<id>.name`, `inventory.item.<id>.description`, `inventory.action.<id>.label` — with the text authored in `defineItems` as the fallback, so adding a catalog needs no change to item definitions. Pass `keys` on `InventoryController` for a different key scheme, and a `msg(...)` binding as `title` for the panel header. A locale switch re-presents the panel, preserving the cursor and an open action menu; item names drive cell and menu-row widths, so the views re-measure rather than swap text in place. With no `LocalizationPlugin` registered every string renders as authored.

`SlotView` carries the resolved `name` and `description` alongside the authored `def`, and `PresentedAction.label` is resolved — custom cell presets and menu skins should render those. Code that constructs a `SlotView` itself (a test double or a custom slots channel) must supply the two new fields.
