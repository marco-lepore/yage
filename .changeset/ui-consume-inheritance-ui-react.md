---
"@yagejs/ui-react": minor
---

Inherit UI input consumption through the display tree.

Make `UIRoot({ consumeInput: false })` provide a transparent default for its descendants. Omitted JSX props inherit the nearest explicit setting. Controls inside transparent HUDs need `consumeInput={true}` to consume their presses; removing the prop restores inheritance.
