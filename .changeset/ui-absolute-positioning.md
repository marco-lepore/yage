---
"@yagejs/ui": minor
"@yagejs/ui-react": minor
---

UI primitives: Button auto-size + ReactNode children, absolute positioning, `<ZStack>` overlay primitive.

- `LayoutProps` gains `position` (`"relative" | "absolute"`, default `"relative"`), `left`, `top`, `right`, `bottom`. Wired to Yoga's `setPositionType` + `setPosition`, so every element can be absolutely positioned against the nearest relative ancestor.
- `UIButton` is now a flex container (implements `UIContainerElement`): `addElement` / `removeElement` / `insertElementBefore` work on it directly. The legacy `panel.button("Label", ...)` API still creates a centered auto-text child; the new container surface enables icon + label compositions.
- `@yagejs/ui-react` `ButtonProps.width` / `.height` are now optional and accept the full `LayoutValue` union (pixels, `%`, `vw` / `vh`, `"auto"`). Omit to shrink-to-fit the button's content. `children` accepts `ReactNode` — strings / numbers auto-wrap in a centered `<Text style={textStyle}>`, elements render as flex children. `ButtonProps.truncate` forwards into the auto-wrapped `<Text>` so fixed-width buttons can ellipsize long labels.
- New `<ZStack>` JSX primitive: a `<Panel>` that defaults to filling its parent with `position: "relative"`, intended as the containing block for Z-axis overlay children (modal backdrops, HUD layers, badge markers). Named after SwiftUI's `ZStack` to distinguish from flex column / row stacking (`<Panel direction="column" | "row">`).
