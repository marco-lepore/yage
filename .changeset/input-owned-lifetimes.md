---
"@yagejs/input": minor
---

Make input lifetimes explicit and keep every edge on the shared input path.

- Add generation-aware pointer cycles and `getPointerPresses()` for current-frame polling.
- Add independently owned sustained actions through `createActionSource()` and remove the manager-wide sustained-action methods.
- Capture action bindings at press time so rebinding affects the next press without retargeting a held input.
- Release physical input on focus loss, scope wheel claims to one event, and suppress wheel actions over marked UI.
- Add physical stick-direction codes, strict analog validation, and physical-only explicit-pad reads.
