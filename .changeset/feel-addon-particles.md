---
"@yagejs/particles": minor
---

Add independently owned particle-emission requests.

- Add `requestEmission()` with independently releasable handles.
- Keep manual emission and overlapping temporary requests from stopping one
  another.
