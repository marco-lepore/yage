---
"@yagejs/core": minor
---

Keep diagnostic frames, clock control, and scene state consistent.

- Use the engine frame count for Inspector readings and expire event waits at frame completion, including freely running games. Validate deadlines before history lookup, match regular expressions without changing their state, and reject pending waits when logging stops or the Inspector is disposed.
- Add exclusive time leases. Drives and asynchronous stepping hold clock ownership until they finish; competing clock mutations fail before issuing frames.
- Include entity names, keys, generations and pool membership, plus scene and engine clock readings, in snapshots. Exclude destroy-pending entities from every count and retain their scene identity in destruction events.
