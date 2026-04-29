---
"@yagejs/input": minor
"@yagejs/core": minor
---

Multi-pointer / touch support across the input layer.

- New per-pointer state keyed by `pointerId`: every active mouse, pen, or finger gets its own tracked entry. `getPointers(): readonly PointerInfo[]` and `getPointer(id): PointerInfo | undefined` expose them; `PointerInfo` carries `{ id, screenPos, type, isPrimary, buttons, isDown }`.
- `pointerType` (`"mouse" | "pen" | "touch"`) is now exposed on every tracked pointer so games can branch on input class (e.g. show or hide a hover indicator).
- Per-pointer event hooks: `onPointerDown(fn)` / `onPointerUp(fn)` / `onPointerMove(fn)` each return a disposer. Up listeners also fire on `pointercancel`, so gesture-tracking code does not need to special-case it.
- `MouseLeft` / `MouseMiddle` / `MouseRight` action codes now use any-pointer aggregation (mirrors the Tier 1 gamepad fix): two simultaneous pointers holding button 0 emit one down edge and one up edge, never spurious duplicates.
- The singular `getPointerPosition()`, `getPointerScreenPosition()`, and `isPointerDown()` continue to report the **primary** pointer (the one the browser flagged `isPrimary`), so existing single-pointer call sites keep working unchanged. `isPointerDown()` now reflects "primary pointer has any of buttons 0/1/2 held" — buttons 3+ no longer set it.
- Synthetic injection (`firePointerMove` / `firePointerDown` / `firePointerUp`) gains an optional second `opts?: { id?, type?, isPrimary? }` argument for driving non-primary or touch pointers in tests. Existing zero-arg / single-arg calls keep their previous semantics.
- `InputStateSnapshot` (from `@yagejs/core`) now exposes a `pointers: PointerSnapshot[]` array next to `mouse`. `mouse` is preserved as a primary-pointer mirror for back-compat with existing inspector tooling.
- `pointercancel` now drops the cancelled pointer entirely and releases the aggregate `MouseLeft`/`Middle`/`Right` edges it was holding — replaces the previous "clear all pointer buttons" handling, which over-cleared when only one of multiple touches was cancelled.
