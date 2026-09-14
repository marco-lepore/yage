---
"@yagejs/ui-react": patch
---

`<Button>` passes `truncateWith` to the label it creates for a string or number child, alongside `truncate`. `truncateWith` is the string the `"ellipsis"` truncate mode appends. It defaults to `"…"`, which several pixel fonts lack, so pass `truncateWith="..."` when the label uses one of them. A button with JSX children does not create a label, so set `truncateWith` on the `<Text>` you pass it.
