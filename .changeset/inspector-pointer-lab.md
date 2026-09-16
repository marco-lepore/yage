---
"@yagejs-tools/lab": patch
---

Add `pointer` to the drive context, so a scenario can click the game's own
menus.

`ctx.input` writes engine input state and never reaches a `@yagejs/ui`
element. `ctx.pointer` has the renderer deliver real pointer events, so a
build menu, a pause screen or a confirm dialog is drivable from a scenario.

```ts
const hit = pointer.click({ x: 70, y: 30 });
expect(hit.path.some((node) => node.type === "UIButton")).toBe(true);
```

Every call is synchronous: it dispatches and returns, spending no frame. The
clicked handler has already run when the call returns; engine input state
reflects the press after `await step(1)`.
