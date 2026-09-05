---
"@yagejs-tools/lab": minor
---

Keep diagnostic frames, clock control, and scene state consistent.

- Use Inspector time leases for play, stepping, and driven runs. Competing clock commands reject, and `whileStopped` passes its lease to the callback.
- Clear retained events before rebuilding a scenario so event waits observe the new run.
- Reject non-finite control bounds and steps, including overflowing default ranges, before storing a control definition.
