---
"@yagejs/ui": minor
"@yagejs/ui-react": minor
---

UI hover events + `<Tooltip>`, and percentage edge offsets for absolute positioning.

- New shared `PointerEventProps` (exported): `onPointerOver?()`, `onPointerOut?()`, and a convenience `onHover?(hovering: boolean)` (`true` on enter / `false` on leave). Wired into `UIButton`, `PanelNode` / `UIPanel`, `UIText`, `UIImage`, `UINineSlice`, `UIProgressBar` — and the matching `@yagejs/ui-react` JSX components (`<Panel>`, `<Button>`, `<Text>`, `<Image>`, `<NineSlice>`, `<ProgressBar>`). Every UI primitive's container is already `eventMode: "static"`, so this is a fan-out, not new infra. A new exported `PointerEvents` helper binds one listener pair and swaps callbacks in place across `update()`; `UIButton` suppresses callbacks while disabled.
- `LayoutProps` `left` / `top` / `right` / `bottom` now accept a `"<n>%"` string in addition to a number (`PositionValue`). Percentages resolve against the containing block, so an absolute child can pin flush to a parent edge (`top: "100%"`) without measuring it.
- New `<Tooltip content={…}>` in `@yagejs/ui-react`: a Mantine-style wrapper (single component, body in a `content` prop — not compound trigger/content subcomponents) that shows a floating bubble while the wrapped trigger is hovered. Props: `content` (string/number auto-wraps in `<Text>`, or arbitrary nodes), `placement` (`"top"` default / `"bottom"` / `"left"` / `"right"`), `offset`, `bg`, `padding`, `textStyle`, `opened` (force visibility), `disabled`. The bubble is out of Yoga flow (never reflows siblings), unclipped, and start-aligned on the cross axis.
