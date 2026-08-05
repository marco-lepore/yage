---
"@yagejs-tools/lab": patch
---

Panel changes for tuning a scenario without losing your place.

- The sidebar, the stage and the controls column each scroll on their own and
  the page never scrolls, so a long scenario list no longer moves the canvas.
- A filter box above the scenario list matches a scenario's title, the group
  names in it, and its file path.
- Group headings fold. A filter opens whatever groups hold a match and
  clearing it restores the folds.
- `copy JSON` on the Controls heading puts every current control value on the
  clipboard as one JSON object.
- `→ right` moves the controls into a column beside the stage, where the whole
  list is visible instead of four rows at a time.
- The canvas takes keyboard focus when clicked. While it has focus the browser
  does not scroll on space, the arrow keys, page up and down, or home and end;
  the game still receives those keys.
