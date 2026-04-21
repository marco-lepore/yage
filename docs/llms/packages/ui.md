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

// Button
const btn = panel.button("Start", {
  width: 200, height: 50,
  background: { color: 0x4444aa },
  hoverBackground: { color: 0x5555cc },
  pressBackground: { color: 0x333388 },
  textStyle: { fontSize: 18, fill: 0xffffff },
  onClick: () => { /* ... */ },
});
btn.setText("Loading...");
btn.setDisabled(true);

// Nested panel
const row = panel.panel({ direction: "row", gap: 12 });
row.text("HP");

// Other elements (UIImage, UIProgressBar, UICheckbox) — instantiate directly:
import { UIProgressBar } from "@yagejs/ui";
const bar = new UIProgressBar({ width: 100, height: 16, value: 0.75 }); // value 0–1
row.addElement(bar);
```

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

## Background Options

```ts
// Solid color
{ color: 0x222222, alpha: 0.9, radius: 8 }

// Nine-slice texture
{ texture: tex, mode: "nine-slice", nineSlice: { left: 12, top: 12, right: 12, bottom: 12 } }
```
