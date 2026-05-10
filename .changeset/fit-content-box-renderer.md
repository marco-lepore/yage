---
"@yagejs/renderer": patch
---

Fix `FitController` resize feedback loop on hosts with a border or padding.

- `FitController` now measures the host's content box (synchronous initial apply via `getBoundingClientRect()` minus computed padding/border, ResizeObserver via `contentBoxSize`) instead of the border-box. Sizing the canvas to the border-box on a host without an explicit height pushed the host's intrinsic block-size up by `2 × border` per apply, the observer re-fired, and the loop only stopped when the host hit a parent-driven cap like `max-height: 100%` — visible as the gradual Y-axis grow on initial mount and on viewport resize-up.
