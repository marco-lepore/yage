---
"@yagejs/physics": patch
---

Fix contact filters reporting zero velocity for moving kinematic bodies. Filters read the velocity of the last completed physics step, matching the body's velocity getters.
