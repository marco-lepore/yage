---
"@yagejs/physics": patch
---

Fix one-way platforms losing a landing when game code changes a body's velocity before contact is detected. Landing now uses recorded collider movement, including moving platforms, without requiring extra configuration or a larger margin. Teleports, shape changes, and reactivation clear previous landing state so a body placed inside a platform can pass out.
