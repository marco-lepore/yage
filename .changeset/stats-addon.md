---
"@yagejs-addons/stats": minor
---

Add numeric stats, equipment modifiers, timed effects, and game-authored damage formulas.

- Compose source-owned base additions, flat bonuses, base percentages, summed percentages, independent multipliers, and priority overrides with optional bounds and rounding.
- Replace equipment modifiers by source, cancel or refresh timed effects, and configure stacking limits, newest-effect selection, or highest-rank selection.
- Let derived stats declare dependencies on base or effective values. Define damage formulas with dependency validation, cycle detection, and named intermediate results.
- Advance effect durations with an optional entity component that follows scene and entity time scaling. Save and restore bases, modifier ownership, stacking order, and remaining durations.
