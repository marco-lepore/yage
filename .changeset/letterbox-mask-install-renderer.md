---
"@yagejs/renderer": patch
---

Letterbox fit clips rendering to the virtual rect, so the bars stay blank.

- Under `fit: { mode: "letterbox" }`, the default, content drawn outside the virtual rect no longer appears in the letterbox or pillarbox bars. Any game whose world extends past its virtual size showed that content in the bars whenever the host's aspect ratio did not match. A side-scroller wider than the viewport is the common case.
- `expand`, `cover`, and `stretch` are unaffected. `expand` still lets the game draw into the bars deliberately, and the other two already cover the canvas.
- A mask assigned to the fit container before fit starts still takes precedence, and stays in place when fit stops.
