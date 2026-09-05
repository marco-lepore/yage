---
"@yagejs/core": patch
---

Add caller-owned vector buffers and coordinate reads without Vec2 construction.

- Add `Vec2Buffer`, alias-safe `Vec2` Into math, scalar Transform setters, and Into getters while preserving immutable snapshot identity.
- Reject non-finite Transform inputs and overflowing pose writes before state changes.
