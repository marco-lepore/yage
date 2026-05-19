---
"@yagejs/ui": patch
"@yagejs/ui-react": patch
---

Fix: `Panel` / `PanelNode` pointer & hover events no longer have dead-zones over un-painted regions.

`PanelNode` now sets an explicit `hitArea` synced to its computed Yoga box every `applyLayout()` (mirroring `ScrollViewNode`'s viewport). A bare `eventMode:"static"` Container is hit-tested only where a descendant actually paints, so previously `onHover` / `onPointerOver` / `onClick` (and `<Tooltip>`, whose trigger wrapper is a `Panel`) silently never fired over flex `gap`, `padding`, or the empty space around shrink-wrapped children on a background-less panel — events landed only over painted descendants. The handlers now fire anywhere within the panel's layout box, and the UI auto-consume pointer fallback likewise covers the whole box. A panel with a full-bleed `background` is unaffected (its background already covered the box).
