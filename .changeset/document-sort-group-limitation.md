---
---

Docs: document the flatten-to-layer `sort` limitation — multi-sprite entities have no per-entity stacking context, so a foreign entity can render between their parts. Covers the same-key + insertion-order workaround and the `ySortBy` shared-entity-key trick, and notes the robust `SortGroupComponent` follow-up (#104). No package source changed.
