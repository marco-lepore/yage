---
"@yagejs/ui-react": patch
---

Add caller-owned vector buffers and coordinate reads without Vec2 construction.

- Reuse Transform coordinate buffers when positioning React UI roots from entities.
