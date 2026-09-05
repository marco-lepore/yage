---
"@yagejs/renderer": patch
---

Add caller-owned vector buffers and coordinate reads without Vec2 construction.

- Add effective-position and coordinate-projection Into queries to cameras.
- Reuse coordinate buffers for display synchronization, sort groups, follow targets, and shared camera transforms.
