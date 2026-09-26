---
"@yagejs/ui-react": patch
---

Optional JSX props accept an explicit `undefined`, so `bg={selected ? highlight : undefined}` type-checks under `exactOptionalPropertyTypes`. The reconciler already resets a prop passed as `undefined` to its default; only the types rejected it. Required props stay required.
