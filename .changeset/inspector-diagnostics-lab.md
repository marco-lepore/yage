---
"@yagejs-tools/lab": minor
---

Keep diagnostic frames, clock control, and scene state consistent.

- Use Inspector time leases for play, stepping, and driven runs. Competing clock commands reject, and `whileStopped` passes its lease to the callback.
- Clear retained events after the old scene exits and before the new scene enters, preserving new entry events for event waits. Skip default transitions on first mount and rebuilds so the scene reaches its initial state without advancing the frozen clock.
- Reject non-finite control bounds and steps, including overflowing default ranges, before storing a control definition.
