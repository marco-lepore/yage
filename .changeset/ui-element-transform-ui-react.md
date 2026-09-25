---
"@yagejs/ui-react": patch
---

A laid-out element can scale and rotate about a point of its own choosing, and be drawn over its siblings.

- `transformOrigin`, `scale`, `rotation` and `zIndex` reach every JSX component, and removing one between renders resets it.
- `UIRoot` stacks its top-level elements about their `transformOrigin`.
