---
"@yagejs-addons/feel": minor
---

Clarify addon composition and lifecycle contracts.

- Add `onCancel` to one-shot sprite animation cues and attribute cancellation callbacks through Feel. Completion and cancellation remain notifications; explicit durations still follow cue retiming, and cues without a duration complete immediately.
