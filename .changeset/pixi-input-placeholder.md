---
"@yagejs/ui": patch
---

`PixiInput` applies a changed `placeholder` prop to the existing element. The
placeholder used to be fixed at construction: passing a new value to
`update()`, or re-rendering `<PixiInput placeholder={hint} />` with a
different `hint`, kept the first text. The change keeps keyboard focus and the
typed value, and the placeholder stays hidden while the field holds a value or
is being edited.
