---
"@yagejs/ui": patch
---

A `PixiSelect` keeps the row the player is on when its `items` are replaced
without a `selected` in the same update, matching `PixiRadioGroup`. Relabelling
the rows no longer resets the choice.

Wrappers whose text changes size (`PixiFancyButton`, `PixiCheckbox`,
`PixiInput`, `PixiSelect`, `PixiRadioGroup`) now mark their layout node for
re-measurement, so a longer string is given the room it needs instead of
keeping the previous allocation.

A `PixiSelect` takes the same space in a layout whether its dropdown is open or
closed. Opening hides the closed button and lifts the list onto the stage,
leaving the Select's own bounds empty, so a layout pass that ran while it was
open sized the surrounding panel as if the dropdown were not there.
