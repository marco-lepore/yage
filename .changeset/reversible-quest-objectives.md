---
"@yagejs-addons/quests": minor
---

Support turn-in quests whose requirements can become incomplete before completion.

- Add the `autoComplete` quest policy and `canComplete()` readiness check.
- Make `completeQuest()` require satisfied objectives and add `forceCompleteQuest()` as the explicit escape hatch.
- Rename objective progress events so both increases and decreases use accurate terminology.
