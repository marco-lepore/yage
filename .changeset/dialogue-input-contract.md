---
"@yagejs-addons/dialogue": minor
---

Three-mode `input` option on `DialogueController`, matching the inventory controller's contract: `input?: InputBinding | null`.

- Omitted `input` now wires the default binding's pointer side to the bundle's own choices presenter — mouse/touch tap picks a choice row and hover highlights it out of the box (previously the zero-config pointer binding could only tap-to-advance). A custom choices presenter without `choiceAtPoint` keeps the old behavior.
- `input: null` attaches no binding at all — the ambient/cutscene/host-driven mode. The host calls `advance()`/`moveSelection()`/`choose()`/`skip()` itself; `setInputEnabled` becomes a no-op.
- An explicit `InputBinding` is used as-is, unchanged.
