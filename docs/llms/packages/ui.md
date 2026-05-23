# @yagejs/ui

Depends on `@yagejs/core`, `@yagejs/renderer`. Yoga flexbox-based UI. Supports both screen-space (HUD) and world-space (diegetic / entity-anchored) positioning based on the target layer's `space`.

## Setup

```ts
import { UIPlugin } from "@yagejs/ui";
engine.use(new UIPlugin());
```

## UIPanel

Root UI component. Positioning is chosen explicitly via the `positioning` option (default `"anchor"`):

- `positioning: "anchor"` — `anchor` resolves against the viewport (`virtualSize`), `offset` is a pixel nudge. Classic HUD. No Transform required.
- `positioning: "transform"` — panel is positioned at `entity.get(Transform).worldPosition` in the target layer's local coord space; `anchor` is reinterpreted as the pivot on the panel itself (e.g. `Anchor.BottomCenter` → panel's bottom-center sits at the Transform). `offset` is still a pixel nudge. Throws at add time if the entity has no `Transform`.

The positioning mode is independent of the target layer's `space`:
- **Screen-space layer + `positioning: "transform"`** = billboard pattern. Pair with `ScreenFollow` from `@yagejs/renderer` which writes `cam.worldToScreen(target) + offset` to this entity's Transform each frame (offset is in screen pixels, applied post-projection). UI stays axis-aligned and constant-size under any camera zoom/rotation.
- **World-space layer + `positioning: "transform"`** = genuinely diegetic UI. Transform holds a world coord; layer scales/rotates the UI like any other world object.

```ts
import { UIPanel, Anchor } from "@yagejs/ui";

// Screen-space HUD (default)
entity.add(new UIPanel({
  anchor: Anchor.TopLeft,
  offset: { x: 16, y: 16 },
  direction: "column",
  gap: 8,
  padding: 16,
  alignItems: "center",
  justifyContent: "center",
  overflow: "visible",
  background: { color: 0x000000, alpha: 0.7, radius: 8 },
  layer: "ui",
  visible: true,
}));

// Billboard nameplate (paired with ScreenFollow elsewhere)
entity.add(new Transform());
entity.add(new ScreenFollow({ target, camera, offset: new Vec2(0, -40) }));
entity.add(new UIPanel({
  positioning: "transform",
  anchor: Anchor.BottomCenter, // pivot on the panel
}));
```

Anchor enum: `TopLeft`, `TopCenter`, `TopRight`, `CenterLeft`, `Center`, `CenterRight`, `BottomLeft`, `BottomCenter`, `BottomRight`.

## Builder API

```ts
const panel = entity.get(UIPanel);

// Text
const label = panel.text("Score: 0", { fontSize: 24, fill: 0xffffff });
label.setText("Score: 100");
label.setStyle({ fill: 0x00ff00 });

// Button — width/height are optional; omit them to shrink-to-content
const btn = panel.button("Start", {
  width: 200, height: 50,                           // optional
  background: { color: 0x4444aa },
  hoverBackground: { color: 0x5555cc },
  pressBackground: { color: 0x333388 },
  textStyle: { fontSize: 18, fill: 0xffffff },
  onClick: () => { /* ... */ },
});
const autoBtn = panel.button("Auto-sized", { onClick: () => {} }); // shrinks to label
btn.setText("Loading...");
btn.setDisabled(true);

// Long/i18n labels: a fixed-size button can't grow, so keep the label on one
// line and ellipsize it instead of letting it spill out of the frame.
panel.button("A very long label that won't fit", { width: 120, truncate: "ellipsis" });

// Button is a flex container — addElement on it for icon + label rows etc.
btn.addElement(new UIImage({ texture: iconTex, width: 16, height: 16 }));

// Nested panel
const row = panel.panel({ direction: "row", gap: 12 });
row.text("HP");

// Scrollable viewport (clipped + wheel/drag pannable). Children are normal
// Yoga elements; size the viewport via LayoutProps (height / flexGrow).
const list = panel.scrollView({
  flexGrow: 1,
  gap: 6,
  // scrollbar: false to hide, or style it: { thickness, color, alpha,
  // radius, minThumbLength, margin }. A gutter (= thumb footprint) is
  // auto-reserved so cards never sit under the thumb (list.scrollbarGutter).
  scrollbar: { thickness: 6, color: 0x8899aa },
});
list.addElement(new UIButton({ children: "Order #1", height: 36 }));
list.scrollTo(0); // also: scrollBy(dy), .scrollOffset, .maxScroll

// Other elements (UIImage, UIProgressBar, UICheckbox) — instantiate directly:
import { UIProgressBar } from "@yagejs/ui";
const bar = new UIProgressBar({ width: 100, height: 16, value: 0.75 }); // value 0–1
row.addElement(bar);
```

## Flex layout defaults

Layout tracks **web flexbox defaults**, not Yoga's raw ones — the divergence
that otherwise makes text/children overflow instead of shrinking:

- **`flexShrink: 1` by default** (Yoga's raw default is `0`). Every element
  gives space back when its row/column is too small, so a `Text` sharing a row
  with a sibling shrinks and wraps inside the box instead of spilling past it.
  Opt a child out with `flexShrink: 0` (e.g. a fixed icon that must keep its
  size); explicit `flexShrink` always wins.
- **Dev-mode overflow warning.** When an in-flow child's computed box still
  spills past its container (e.g. a `flexShrink: 0` child too big to fit, or a
  wrapped label taller than a fixed-height button), a `console.warn` fires once
  for that node. Silenced in production builds (`NODE_ENV=production`), and for
  intentional overflow — `overflow: "hidden"` containers, `position:
  "absolute"` children, and ScrollView content.

Fixes: give the container more room, set `maxWidth`/`maxHeight`, let the content
wrap, or use `truncate: "clip" | "ellipsis"` on text (and `UIButton`).

## UIText: bitmap & resolution

`UIText` (and the `panel.text(...)` builder, `UIButton` labels, the React `<Text>`) accept two extra props for crisp pixel-art text. Yoga measurement — the default word-wrap and the `truncate?: "clip" | "ellipsis"` modes — is unchanged on the bitmap path.

```ts
// Dynamic bitmap font baked from the text's own style (zero-config).
new UIText({ children: "SCORE", bitmap: true, style: { fontFamily: "monospace", fontSize: 12 } });

// An installed / loaded bitmap font by name; `size` overrides glyph size.
new UIText({ children: "READY", bitmap: { font: "PressStart", size: 16 } });

// Per-text canvas resolution (see gotcha below).
new UIText({ children: "HUD", resolution: window.devicePixelRatio });
```

Use `installBitmapFont(...)` / `bitmapFont(...)` from `@yagejs/renderer` to obtain a font name for `bitmap: { font }`.

**`resolution` gotcha (Pixi v8).** `resolution` is a `Text` *constructor* option, NOT a `TextStyle` property — setting `TextStyle.defaultTextStyle.resolution` does nothing. Pass `resolution` explicitly per text for crisp canvas output without a prototype patch, or use `bitmap` for pixel-perfect rendering. `resolution` is ignored when `bitmap` is set (bitmap resolution is fixed at font-bake time).

## LoadingSceneProgressBar

Drop-in progress bar for a `LoadingScene` (in `@yagejs/core`). Subscribes to `scene:loading:progress` internally and updates a `UIProgressBar`. Spawn inside a `LoadingScene` (throws otherwise). Full contract: `loading-scene.md`.

```ts
import { LoadingSceneProgressBar } from "@yagejs/ui";

this.spawn(LoadingSceneProgressBar, {
  width: 400,                               // default 400
  height: 16,                               // default 16
  track: { color: 0x1e293b },               // bar background
  fill: { color: 0x38bdf8 },                // bar fill
  backdrop: { color: 0x0b0f14 },            // full-viewport bg (default: none)
  anchor: Anchor.Center,
  offset: { x: 0, y: 40 },
  layer: "ui",
});
```

Pass `backdrop` when the loading scene is transitioned into — without it the scene is transparent and the previous scene bleeds through the fade.

## Visibility

```ts
panel.visible = false; // hide
label.visible = true;
```

## Absolute Positioning

Every element accepts `position`, `left`, `top`, `right`, `bottom` via `LayoutProps`:

```ts
// Pin a badge to the top-right of its parent. The parent must be
// `position: "relative"` (the default) so it acts as the containing block.
const badge = panel.panel({
  position: "absolute",
  top: 8,
  right: 8,
  background: { color: 0xff0000, radius: 12 },
});
```

Absolute children are lifted out of the flex flow and resolved against the
parent's content box. `left` / `top` / `right` / `bottom` accept a number
(px) or a `"<n>%"` string that resolves against the containing block — so
`top: "100%"` is flush below the parent (powers edge-anchored overlays like
tooltips without measuring). Omit unused edges.

## Hover / pointer events

`UIButton`, `PanelNode` / `UIPanel`, `UIText`, `UIImage`, `UINineSlice`,
`UIProgressBar` accept `PointerEventProps` (shared, exported): independent,
combinable `onPointerOver?()` / `onPointerOut?()` and a convenience
`onHover?(hovering: boolean)` (`true` on enter, `false` on leave). Every UI
primitive's container is already `eventMode: "static"` (consume-input
fallback), so wiring is a fan-out. The shared `PointerEvents` helper (also
exported) binds one listener pair and swaps callbacks in place on
`update()`; `UIButton` suppresses callbacks while disabled.

```ts
new UIButton({ children: "Save", onHover: (h) => setGlow(h) });
panel.panel({ onPointerOver: showDetail, onPointerOut: hideDetail });
```

The React layer (`@yagejs/ui-react`) exposes these props on the matching
JSX components plus a Mantine-style `<Tooltip content=…>` built on
`onHover`.

## Background Options

```ts
// Solid color
{ color: 0x222222, alpha: 0.9, radius: 8 }

// Nine-slice texture
{ texture: tex, mode: "nine-slice", nineSlice: { left: 12, top: 12, right: 12, bottom: 12 } }
```
