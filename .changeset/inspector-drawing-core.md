---
"@yagejs/core": minor
---

Control drawing during automated play.

Add `render: "all" | "last" | "none"` to asynchronous Inspector stepping and whole drives, including input cleanup. Captures flush current rendering without advancing game time.

If an input-release callback throws during drive cleanup, stop cleanup and reject the drive, leaving the clock frozen and its lease held.
