---
"@yagejs/renderer": minor
---

Visual components carry their own draw order, and a layer's depth-key function reads a `SortItem` built by the renderer.

- Breaking: `LayerSortFn` is `(item: SortItem) => number`. `SortItem` holds the child's `x` and `y`, the owning component's `sortOffset`, and its `entity` (`undefined` for a container no component owns). A custom sort written as `(c) => c.position.y` becomes `(item) => item.y`.
- Breaking: `ySortBy` is removed. Set `sortOffset` on the visual and use `ySort`, which keys a child at `y + sortOffset`.
- `VisualComponent` has `zIndex` and `sortOffset`, as accessors and as options on every visual. `zIndex` orders a visual among its siblings on a layer without `sort` and inside a `SortGroupComponent` without `innerSort`; on a sorted layer it logs one development warning. Both throw on a non-finite value.
- `setLayer`, and a `SortGroupComponent` gathering or releasing its members, re-apply each visual's `zIndex`, so a visual leaving a sorted layer does not keep its last depth key as its draw order.
- A `SortGroupComponent` keys off its owner's visual including that visual's `sortOffset`.
