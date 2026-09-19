# @yagejs/ui

Depends on `@yagejs/core`, `@yagejs/renderer`. Yoga flexbox-based UI. Supports both screen-space (HUD) and world-space (diegetic / entity-anchored) positioning based on the target layer's `space`.

## Setup

```ts
import { UIPlugin } from "@yagejs/ui";
engine.use(new UIPlugin());

// Optional: an app-wide default style for UI text (UIText, UISplitText, and
// auto-wrapped Button/Checkbox labels). Layered over RendererConfig.defaultTextStyle;
// per-text `style` still wins.
engine.use(
  new UIPlugin({ defaultTextStyle: { fontFamily: "Inter", fill: 0xffffff } }),
);
```

## UISurface

Root UI component — mounts a UI tree on an entity. Its public `root` is the tree's root `UIPanel` element (`surface.root`). The builder methods below forward to it. Positioning is chosen explicitly via the `positioning` option (default `"anchor"`):

- `positioning: "anchor"` — `anchor` resolves against the viewport (`virtualSize`), `offset` is a pixel nudge. Classic HUD. No Transform required.
- `positioning: "transform"` — panel is positioned at `entity.get(Transform).worldPosition` in the target layer's local coord space; `anchor` is reinterpreted as the pivot on the panel itself (e.g. `Anchor.BottomCenter` → panel's bottom-center sits at the Transform). `offset` is still a pixel nudge. Throws at add time if the entity has no `Transform`.

The positioning mode is independent of the target layer's `space`:

- **Screen-space layer + `positioning: "transform"`** = billboard pattern. Pair with `ScreenFollow` from `@yagejs/renderer` which writes `cam.worldToScreen(target) + offset` to this entity's Transform each frame (offset is in screen pixels, applied post-projection). UI stays axis-aligned and constant-size under any camera zoom/rotation.
- **World-space layer + `positioning: "transform"`** = genuinely diegetic UI. Transform holds a world coord; layer scales/rotates the UI like any other world object.

```ts
import { UISurface, Anchor } from "@yagejs/ui";

// Screen-space HUD (default)
entity.add(
  new UISurface({
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
  }),
);

// Billboard nameplate (paired with ScreenFollow elsewhere)
entity.add(new Transform());
entity.add(new ScreenFollow({ target, camera, offset: new Vec2(0, -40) }));
entity.add(
  new UISurface({
    positioning: "transform",
    anchor: Anchor.BottomCenter, // pivot on the panel
  }),
);
```

Anchor enum: `TopLeft`, `TopCenter`, `TopRight`, `CenterLeft`, `Center`, `CenterRight`, `BottomLeft`, `BottomCenter`, `BottomRight`.

## Builder API

```ts
const panel = entity.get(UISurface);

// Text
const label = panel.text("Score: 0", { fontSize: 24, fill: 0xffffff });
label.setText("Score: 100");
label.setStyle({ fill: 0x00ff00 }); // replace — unset props revert to default
label.mergeStyle({ fill: 0x00ff00 }); // patch — keeps the current font/size/etc

// Button — width/height are optional; omit them to shrink-to-content
const btn = panel.button("Start", {
  width: 200,
  height: 50, // optional
  background: { color: 0x4444aa },
  hoverBackground: { color: 0x5555cc },
  pressBackground: { color: 0x333388 },
  textStyle: { fontSize: 18, fill: 0xffffff },
  onClick: () => {
    /* ... */
  },
});
const autoBtn = panel.button("Auto-sized", { onClick: () => {} }); // shrinks to label
btn.setText("Loading...");
btn.setDisabled(true);

// Long/i18n labels: a fixed-size button can't grow, so keep the label on one
// line and ellipsize it instead of letting it overflow the frame.
panel.button("A very long label that won't fit", {
  width: 120,
  truncate: "ellipsis",
});

// Button is a flex container, stacking its children in a column. Ask for a
// row to put an icon beside the label.
const iconBtn = panel.button("Buy", { direction: "row", gap: 6 });
iconBtn.addElement(new UIImage({ texture: iconTex, width: 16, height: 16 }));

// A button's own defaults, all overridable:
//   background        { color: 0x444444, alpha: 1, radius: 4 }
//   hoverBackground   the resting background at 1.25x brightness
//   pressBackground   the resting background at 0.75x
//   padding           12 px horizontal, 6 px vertical, unless BOTH width and
//                     height are pinned, or the caller passes `padding`
//   direction         "column"; alignItems and justifyContent both "center"
//
// The hover and press states are derived from whatever background the button
// resolved, so a textured or recoloured button keeps its look while pressed.
// A texture background varies its `tint` instead of its colour: at the default
// white tint hover leaves the art untouched and press darkens it. A colour
// already near full brightness brightens less than 1.25x, because channels
// clamp at 255. Pass `hoverBackground` / `pressBackground` to take over.
//
// To ask for no background at all, ask for a transparent one:
panel.button("Bare", { background: { color: 0x000000, alpha: 0 } });
// `update({ background: undefined })` resets to the grey default instead —
// a present-but-undefined key means "reset this prop to its default"
// everywhere in this package, and a bare button has to stay visible.

// Nested panel
const row = panel.panel({ direction: "row", gap: 12 });
row.text("HP");

// A scroll view carries the same four builders as a panel, adding to its
// content: list.text(...), list.button(...), list.panel(...),
// list.scrollView(...).
//
// Scrollable viewport (clipped + wheel/drag pannable). Children are normal
// Yoga elements; size the viewport via LayoutProps (height / flexGrow).
// A drag starts after 10 px and does not click a child button on release.
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
bar.update({ value: 0.4 });
bar.value; // 0.4 — reads back the clamped fill fraction

// Move the whole tree without touching the anchor: one setOffset per frame is
// how a panel slides in. `surface.offset` reads it back.
surface.setOffset(0, -120);
```

## Flex layout defaults

Layout uses **Yoga's raw defaults**, notably **`flexShrink: 0`** — an element
keeps its natural main-axis size and _overflows_ a too-small row/column rather
than being crushed. This is _not_ the web's `flexShrink: 1`: Yoga has no
`min-width: auto` content floor, so a global `1` crushes fixed-size siblings and
collapses scroll content (a ScrollView's content must exceed its viewport to
scroll). Shrinking and wrapping are therefore **opt-in**:

- **`flexShrink: 1`** — the child gives space back when the line is too small
  (text then re-wraps). Explicit `flexShrink` always wins.
- **`flex: <number>`** — shorthand for `flexGrow: <n>` + `flexShrink: 1` +
  `flexBasis: 0` (CSS `flex: <n>`). Use it for a "fill the remaining space"
  child — e.g. the text column between a fixed icon and a fixed button: it sizes
  from a `0` basis instead of claiming its content width, so it won't push
  siblings and its text wraps cleanly. **Prefer `flex: 1` over `flexGrow: 1`**:
  `flexGrow: 1` alone keeps `flexBasis: auto` (content width) and overflows.

```ts
// Fixed icon, growing/wrapping text column, fixed button — the common row.
row.panel({ width: 16, height: 16 }); // fixed, flexShrink 0 (default)
const col = row.panel({ flex: 1, direction: "column" }); // fills + wraps
col.text("a long label that wraps within the column");
row.button("Buy", { width: 68, onClick: () => {} }); // fixed
```

**Text only wraps when a width constraint reaches it** — some ancestor must have
a definite width (an explicit `width`, or a `flex`/`flexShrink` child shrunk to
a definite size). The root is laid out shrink-to-content: no viewport width is
imposed, so bigger-than-screen UIs like skill trees work. Give a top-level
panel an explicit `width` to bound and wrap its contents.

- **Dev-mode overflow warning.** When an in-flow child's computed box overflows
  its container, a `console.warn` fires once for that node. Silenced in
  production builds (`NODE_ENV=production`) and for intentional overflow:
  `overflow: "hidden"` containers, `position: "absolute"` children, and
  ScrollView content.

Fixes: give the container more room, set `maxWidth`/`maxHeight`, mark the child
`flexShrink: 1` / `flex: <n>` so it gives space back and wraps, or use
`truncate: "clip" | "ellipsis"` on text (and `UIButton`).

The warning names the entity that owns the tree, the child's position in its
parent, its element class and the text it renders, so it points at one element
rather than a pixel count. It tolerates two points of overflow, which is the
largest gap Yoga's own pixel rounding can open between a measured text node
and a shrink-to-fit parent at a fractional position.

- **Dev-mode nine-slice warning.** A nine-slice element or background laid out
  smaller than `left + right` or `top + bottom` insets has no room for its
  middle row or column: the corners overlap and the art folds in on itself,
  which reads as a positioning bug. A `console.warn` fires in development
  builds, and again if the element fits and later shrinks below its insets.
  Nothing is clamped — give the element more room, or use art with smaller
  insets.

## UIImage sizing

```ts
new UIImage({ texture: "card-art", height: 58 }); // width follows the picture
new UIImage({ texture: "card-art", width: 120 }); // height follows the picture
new UIImage({ texture: "banner", width: 180, height: 58 }); // stretched to the box
new UIImage({ texture: "icon" }); // the texture's own pixel size
```

Sizing exactly one axis gives the element the texture's aspect ratio, so a flex
parent's cross-axis stretch cannot squash the picture.

- The derived axis follows the texture, not the room left in the parent, so the
  image can overflow its container. The dev-mode overflow warning reports it.
- Sizing both axes is the only way to distort the texture. `flexGrow`, `flex`
  and `flexBasis` count as sizing the main axis, so an image with one of those
  set stretches as if both axes were sized.
- With neither axis sized the image measures at the texture's pixel size and is
  a normal flex child: a parent's `alignItems: "stretch"` stretches it. Size one
  axis, or set `alignSelf: "flex-start"`, to keep the proportions.
- `maxWidth` / `maxHeight` shrink both axes when one axis is sized: a 100 × 50
  texture at `height: 50, maxWidth: 40` computes 40 × 20.

## UIText: bitmap & resolution

`UIText` (and the `panel.text(...)` builder's third argument, `UIButton` labels, the React `<Text>`) accept two extra props for crisp pixel-art text. Yoga measurement — the default word-wrap and the `truncate?: "clip" | "ellipsis"` modes — is unchanged on the bitmap path.

`truncateWith` sets the string `"ellipsis"` appends; it defaults to `"…"`
(U+2026), which several pixel fonts lack, so pass `"..."` for one of those.
`UIButton` forwards it to its label alongside `truncate`.

A `UIText` that Yoga sizes without measuring wraps to its computed width, and
one with `truncate` set cuts to it. Yoga calls a measure function only when an
axis is left to measure: both axes pinned leaves nothing, and so does a single
pinned axis inside a plain panel, where the default stretch alignment fills the
other one. The layout pass applies the wrap or the truncation in those cases.

```ts
// `bitmap: true` bakes (or looks up) the atlas from `style.fontFamily`
// at `style.fontSize` — the font is a normal style property.
new UIText({
  children: "SCORE",
  bitmap: true,
  style: { fontFamily: "monospace", fontSize: 12 },
});

// An installed / loaded bitmap font: name it via fontFamily.
new UIText({
  children: "READY",
  bitmap: true,
  style: { fontFamily: "PressStart", fontSize: 16 },
});

// Per-text canvas resolution (see gotcha below).
new UIText({ children: "HUD", resolution: window.devicePixelRatio });
```

Use `installBitmapFont(...)` / `bitmapFont(...)` from `@yagejs/renderer` to obtain a font name, then pass it as `style.fontFamily` with `bitmap: true`. `bitmap` is a sibling prop of `style`, not a style key — nesting it (`style: { …, bitmap }`) is ignored and warns in dev. To recolour bitmap text at runtime use `mergeStyle({ fill })` so `fontFamily` survives; `setStyle({ fill })` replaces the style and drops the font.

`UIButton` and the React `<Button>` forward a `bitmap` boolean to their auto-wrapped string label: `new UIButton({ children: "PLAY", bitmap: true, textStyle: { fontFamily: "PressStart" } })` / `<Button bitmap textStyle={{ fontFamily: "PressStart" }}>PLAY</Button>`. (No effect when the child is a composed element — set `bitmap` on that `<Text>` directly.)

**`resolution` gotcha (Pixi v8).** `resolution` is a `Text` _constructor_ option, NOT a `TextStyle` property — setting `TextStyle.defaultTextStyle.resolution` does nothing. Pass `resolution` explicitly per text for crisp canvas output without a prototype patch, or use `bitmap` for pixel-perfect rendering. `resolution` is ignored when `bitmap` is set (bitmap resolution is fixed at font-bake time).

## UISplitText — animated / per-glyph text

UI sibling of `@yagejs/renderer`'s `SplitTextComponent` (wraps Pixi's experimental `SplitText` / `SplitBitmapText`). Lays the whole block out as one Yoga element and exposes `chars` / `words` / `lines` for animation. **No `truncate` / word-wrap** (pre-break with `\n`, or use `UIText` for paragraphs). It measures its natural size via Pixi text metrics, so the Yoga box doesn't jitter as you animate glyphs.

```ts
import { UISplitText } from "@yagejs/ui";

const title = new UISplitText({
  children: "GAME OVER",
  style: { fontSize: 48, fill: 0xffffff },
  charAnchor: 0.5, // segment pivots: char / word / lineAnchor
  // bitmap: true, autoSplit: false,   // font via style.fontFamily
});
panel.addElement(title);

title.chars; // (Text | BitmapText)[]   title.words / title.lines: Container[]
title.onSplit((seg) => {
  /* rebind animations — fires after each re-split */
});
title.setText("YOU WIN"); // destroys + recreates chars, then onSplit
```

API: `chars` / `words` / `lines` getters, `segments`, `setText`, `setStyle`, `resplit()`, `charAnchor` / `wordAnchor` / `lineAnchor` (get/set), `onSplit(cb) → unsubscribe`. Animate the segments with the engine's `Tween` / `Process` — the element doesn't impose an animation API.

**React:** `<SplitText>` (props mirror `<Text>` minus `truncate`, plus the three anchors + `autoSplit`) and the `useSplitText()` hook. The hook returns a `[ref, controls]` tuple — `controls` has live `chars` / `words` / `lines` / `segments` getters, `resplit()`, and `run(process | process[])`. `run` enqueues on a scene-scoped process queue (pauses with the scene; cancelled on unmount and on re-split, so a tween never writes to a destroyed glyph) and returns `{ cancel() }` for that batch. Animate imperatively from any handler — pair `run` with `Tween.stagger(items, factory, stepSeconds)` to cascade a tween across the segments.

```tsx
const [ref, split] = useSplitText();
const reveal = () => {
  split.chars.forEach((c) => (c.alpha = 0));
  split.run(
    Tween.stagger(
      split.chars,
      (c) => Tween.custom((v) => (c.alpha = v), 0, 1, 0.3),
      0.05,
    ),
  );
};
return (
  <SplitText ref={ref} charAnchor={0.5} onPointerDown={reveal}>
    {label}
  </SplitText>
);
```

`SplitText` is experimental in Pixi and re-lays-out on every `text` / `style` change — prefer `UIText` for static / simple dynamic labels.

## LoadingSceneProgressBar

Drop-in progress bar for a `LoadingScene` (in `@yagejs/core`). Subscribes to `scene:loading:progress` internally and updates a `UIProgressBar`. Spawn inside a `LoadingScene` (throws otherwise). Full contract: `loading-scene.md`.

```ts
import { LoadingSceneProgressBar } from "@yagejs/ui";

this.spawn(LoadingSceneProgressBar, {
  width: 400, // default 400
  height: 16, // default 16
  track: { color: 0x1e293b }, // bar background
  fill: { color: 0x38bdf8 }, // bar fill
  backdrop: { color: 0x0b0f14 }, // full-viewport bg (default: none)
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
(px) or a `"<n>%"` string that resolves against the containing block, so
`top: "100%"` is flush below the parent. This is useful for edge-anchored
overlays like tooltips, without measuring. Omit unused edges.

## Hover / pointer events

`UIButton`, `UICheckbox`, `UIPanel`, `UIText`, `UIImage`, `UINineSlice`,
`UIProgressBar`, `UIScrollView` and the six interactive `@pixi/ui` wrappers
accept `PointerEventProps` (shared, exported): independent, combinable
`onPointerOver?()` / `onPointerOut?()` and a convenience
`onHover?(hovering: boolean)` (`true` on enter, `false` on leave). Every UI
primitive's container is already `eventMode: "static"` (consume-input
fallback), so these callbacks need no extra setup. The shared `PointerEvents`
helper (also exported) binds one listener pair and swaps callbacks in place on
`update()`. An element with a disabled state — `UIButton`, `UICheckbox`, and a
wrapper whose `@pixi/ui` view carries an enabled flag — takes no pointer
events while disabled, so its callbacks do not fire.

```ts
new UIButton({ children: "Save", onHover: (h) => setGlow(h) });
panel.panel({ onPointerOver: showDetail, onPointerOut: hideDetail });
```

The React layer (`@yagejs/ui-react`) exposes these props on the matching
JSX components plus a Mantine-style `<Tooltip content=…>` built on
`onHover`.

## Keyboard and gamepad focus

`focus` on a `UISurface` or a `UIPanel` makes it a focus scope over its
descendants. The four direction actions move focus between the scope's
visible, enabled, focusable elements, confirm paints the focused element
pressed while the action is held and runs that element's own action on the
release, and cancel calls `onCancel`.

```ts
import { Anchor, UISurface } from "@yagejs/ui";

const menu = entity.add(
  new UISurface({ anchor: Anchor.Center, gap: 8, focus: true }),
);
menu.button("Resume", { width: 220, onClick: resume });
menu.button("Quit", { width: 220, onClick: quit });

menu.focusScope; // UIFocusScope | null; panel.focusScope on a nested scope
```

`UISurfaceOptions extends UIPanelProps`, so `focus` is one prop on both.
`UIButton`, `UICheckbox` and the six interactive `@pixi/ui` wrappers are
focusable by default; any other element joins with `focusable: true`.

### Scope options

```ts
focus?: boolean | UIFocusScopeOptions; // `true` takes every default

interface UIFocusScopeOptions {
  wrap?: boolean; // default true — past the last element, back to the first
  autoFocus?: boolean; // default true — focus the first candidate on taking input
  input?: UIFocusInputOptions | null;
  pointerFocus?: PointerFocusMode; // default "press" — what the pointer does to focus
  modal?: boolean; // default true — this scope owns the pointer while it reads input
  scrollPadding?: number; // default 8 — px kept clear of a UIScrollView edge
  onFocusMove?: (el: UIElement | null, previous: UIElement | null) => void;
  onActivate?: (el: UIElement) => void;
  onMoveBlocked?: (direction: FocusDirection) => void;
  onCancel?: () => void;
}

interface UIFocusInputOptions {
  up?: string | readonly string[]; // default "move-up"
  down?: string | readonly string[]; // default "move-down"
  left?: string | readonly string[]; // default "move-left"
  right?: string | readonly string[]; // default "move-right"
  confirm?: string | readonly string[]; // default "interact"
  cancel?: string | readonly string[]; // default "cancel"
  repeat?: boolean | { delay?: number; interval?: number }; // default true
}

type FocusDirection = "up" | "down" | "left" | "right";
type PointerFocusMode = "none" | "press" | "hover";
```

Each role takes one action name or a list, so a map carrying both `interact`
and `attack` can bind both to confirm. `repeat` applies to the four directions
only — confirm and cancel never repeat — and counts on the raw input clock, so
a menu over a paused scene keeps repeating. `onMoveBlocked` is the only way to
hear a refused move, since the scope drives itself. Every callback runs
through the UI error boundary: a throw is recorded on
`Inspector.getErrors().callbackErrors` and rethrown, and the rest of that
focus step does not run. `scrollPadding` and `repeat.delay` must be finite and
at or above zero, and `repeat.interval` finite and above zero; anything else
throws at the constructor and at `setOptions`, naming the value.

**A scope consumes no action.** A confirm press that activates a menu row is
still visible to gameplay code polling the same action in that frame, and to
the dialogue and interaction addons, which poll `interact` by default. Keeping
menu input out of gameplay is what input groups are for:
`input.setActiveGroups(["menu"])` while the menu is up, and the gameplay
groups back when it closes.

### Per-element props

`FocusProps` is mixed into every element's props interface, beside
`PointerEventProps`:

```ts
interface FocusProps {
  focusable?: boolean;
  focusId?: string;
  focusNeighbors?: FocusNeighbors;
  onFocusChange?: (focused: boolean) => void;
  onAdjust?: (direction: -1 | 1) => void;
  focusStyle?: UIFocusStyle | null; // null: draw no outline here
}

interface FocusNeighbors {
  up?: string | null;
  down?: string | null;
  left?: string | null;
  right?: string | null;
}
```

- `focusable: false` takes an element out of navigation without disabling it,
  so the pointer still reaches it.
- `focusId` names an element so a sibling can point at it, and must be unique
  inside one scope. Two elements claiming one id draw a development warning
  and the first in tree order answers to it.
- `focusNeighbors` names where one direction goes, in place of the nearest
  element that way. A string matching a current candidate wins outright.
  `null` stops movement in that direction: no fallback, no wrap,
  `onMoveBlocked` fires. A string matching nothing at the moment is ignored
  and the nearest element wins, so a row hidden by a filter does not strand
  its neighbour.
- `onFocusChange` is where most games show focus, since an element draws an
  outline only where a `focusStyle` asks for one. It also fires `false` when
  the scope stops taking input, so a highlight the game paints itself goes out
  with the scope.
- `focusStyle` is the outline for this element alone, over the plugin's,
  field by field; `null` draws none here.
- `onAdjust` receives `-1` for left and `1` for right while the element is
  focused and consumes that press — what a volume or difficulty row needs. Up
  and down always move focus, so a column of stepper rows stays traversable.
  On a widget with its own stepper (`PixiSlider`, `PixiSelect`,
  `PixiRadioGroup`) the game's `onAdjust` wins on the horizontal axis.

```ts
const row = menu.panel({
  direction: "row",
  gap: 12,
  focusable: true,
  focusId: "volume",
  focusNeighbors: { down: "saves-first" },
  onAdjust: (d) => setVolume(volume + d * 5),
});
```

### The pointer and focus

Hovered and focused are separate states, the way they are on a web page.
Pressing a control focuses it; passing the pointer over one changes which
control looks hovered and nothing else, so a player walking a list with the
arrow keys keeps their row when the mouse drifts across it. The pointer
leaving a focused control does not clear the focus, so the keyboard picks up
where the mouse left off.

`pointerFocus` on the scope decides which pointer input moves focus:

```ts
new UISurface({ focus: { pointerFocus: "hover" } });
menu.focusScope?.setOptions({ pointerFocus: "hover" }); // applies at once
```

| Value               | Hovering a control | Pressing a control |
| ------------------- | ------------------ | ------------------ |
| `"press"` (default) | nothing            | focuses it         |
| `"hover"`           | focuses it         | focuses it         |
| `"none"`            | nothing            | nothing            |

`"hover"` is the console-style menu with one lit row. `"none"` leaves focus to
the keyboard and the gamepad alone. A press focuses under `"hover"` as well,
because a touch press arrives with no hover before it and would otherwise
reach nothing.

Under every setting, the element's own hovered and pressed looks are painted
and a click runs the element's action. Pointer focus resolves to the deepest
focusable element the pointer reached: a `UIButton` inside a `focusable` row
takes the focus, not the row. A disabled element moves focus on neither event,
and a pointer resting on one row does not pull focus back while the directions
walk the list. Each scope answers for its own setting, so a submenu can follow
the pointer while the menu behind it does not.

Holding confirm on one row and pressing another drops the held press without
running its action and lands focus on the row that was pressed — the rule the
pointer already follows when a release lands outside the control the press
began on.

### Activation and the confirm press

```ts
button.activate(); // runs onClick, leaving a press in progress alone
checkbox.activate(); // toggles `checked`, redraws, then runs onChange
button.focused; // boolean
button.focusable; // boolean
checkbox.disabled; // reads back what setDisabled wrote
```

`activate()` is what the confirm action runs, and the pointer-release path
calls it too, so one disabled guard covers a click and a confirm press. A
disabled element does nothing. `update({ checked })` still sets a checkbox
silently.

A confirm press is a phase, not an instant. The scope paints the focused
element pressed on the confirm edge, keeps that look for as long as the player
holds the action, and runs `activate()` — then `onActivate` — on the release.
A held confirm runs the action once and moves focus nowhere. Anything that
takes the element out from under the press cancels it and runs nothing: focus
moving, the pointer hovering another row, the element being hidden, disabled
or destroyed, or the scope losing input. That is the rule the pointer already
follows, where dragging off a button before releasing it cancels the click.

Only the player ending the hold runs the action. A hold that ends because the
engine dropped the held state — the window losing focus, the page hiding, the
confirm action's input group switched off, a gamepad disconnecting, a
cancelled pointer gesture, `InputManager.clearAll()` — drops the press
unpainted and runs nothing, so a player can alt-tab away from a held confirm
on a destructive row and come back to nothing having happened. A press and its
release that arrive in the same frame, such as a quick tap or a scripted key
press, resolve in that frame: the action runs and the pressed look is never
shown.

`UIButton` paints its press background, `UICheckbox` darkens its box, a
`PixiFancyButton` shows its `pressedView` and a `PixiSelect` presses its
closed button — the look each already shows under the pointer. An element
with no action of its own, such as a `focusable` `UIPanel`, paints no press.

**An element looks pressed while any device holds it, and each device releases
only its own hold.** A player holding the mouse on a row and pressing confirm
on the gamepad sees one pressed row, and it stays pressed until both are let
go — the mouse wandering off the row ends the mouse's hold and leaves the
confirm press painted. Each completed press runs the action once, so that
player runs it twice, the way a browser fires `click` for a mouse release and
for an Enter key on the same button.

`scope.activate()`, `button.activate()` and `checkbox.activate()` called from
game code run at once and paint no press: the pressed look is the picture of a
held action, and a call holds nothing.

### The focused look

Focus draws nothing until a game asks for it. Most games show the focused row
from `onFocusChange` — a marker beside it, a swapped sprite, a sound:

```ts
const line = menu.panel({ direction: "row", gap: 6, alignItems: "center" });
const marker = line.text("", { fontSize: 12 }, { width: 10 });

line.button("Continue", {
  flex: 1,
  onFocusChange: (focused) => marker.setText(focused ? ">" : ""),
  onClick: () => resume(),
});
```

`onFocusChange` fires `true` on arrival and `false` on departure, including
when the scope stops taking input, whether or not an outline is drawn.
`Inspector` snapshots report the focused element either way.

`focusStyle` asks for the package's own outline, set once for the whole UI or
on one element. It is drawn just inside the element's own box, by every
focusable element in the package, first-party and `@pixi/ui` wrapper alike.
Hover and press keep their fills, so a row the pointer is on that a confirm
press would also hit shows its hover tint with the outline on top.

```ts
new UIPlugin({ focusStyle: { color: 0x7dd3fc, width: 2 } }); // whole UI
new UIButton({ children: "Save", focusStyle: { width: 3 } }); // one element
new UIButton({ children: "Quit", focusStyle: null }); // this element draws none

// The shape of both, on `UIPluginOptions.focusStyle` and on `FocusProps`:
interface UIFocusStyle {
  color?: number; // default: defaultTextStyle.fill when it is a number, else white
  width?: number; // px, default 2
  radius?: number; // default: the element's own background radius, else 4
  inset?: number; // px between the box and the outline's outer edge, default 0
}
```

`focusStyle: null` on an element drops a UI-wide outline for that element
alone, which is how one pane carries a marker of its own while the rest of the
UI is outlined. An element that never draws an outline builds no `Graphics`
for one.

Each field resolves on its own: the element's value, then the plugin's, then
the default. Leaving `color` out follows the UI default text fill, so a game
whose text carries a themed fill gets an outline in that same colour and a
light palette gets a readable one. A fill written as a CSS string or a
gradient names no colour here, and the outline falls back to white. Leaving
`radius` out follows the element's own background radius, so a rounded button
and the wrapper beside it are rounded the same while focused.

The outline is drawn inside the box and left out of local bounds, so taking
focus changes no measured size and reaches over no neighbour.

A `@pixi/ui` wrapper decides the rectangle the outline follows by overriding
the protected `focusOutlineBox()`, which returns a `UIFocusOutlineBox`:

```ts
interface UIFocusOutlineBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly radius?: number; // followed when no style names one
}
```

The coordinates are in the widget view's own space. The default covers both
the box layout gave the widget and everything the widget draws, so a part
reaching outside that box — a slider knob standing taller than its track — is
inside the outline rather than cut by it. A widget whose drawn extent moves
with its value returns a box that holds every value, so the outline stays
still while the value changes.

`focusBackground` on a `UIButton` or a focusable `UIPanel` fills the focused
row, painted while the element holds focus and the pointer is not on it. It is
an opt-in: omitted, a focused element keeps its resting background, and
whatever the game asked for — an outline, a marker of its own, nothing —
carries the focus on its own. An override supplying only a colour keeps the
resting corner radius. A panel with no `background` of its own paints this
fill while focused and nothing at rest, which is the menu row that is
transparent until it is selected.

### Scroll views

```ts
list.scrollIntoView(element, { align: "nearest", padding: 8 });
list.viewportWidth; // clipped viewport size in px, 0 before the first layout
list.viewportHeight;
```

Focus landing on a row inside a `UIScrollView` scrolls that row in, keeping
`scrollPadding` px clear of the edge, so a game reads no viewport size and no
offset. The follow runs again when a layout pass moves the focused row inside
the content or resizes the viewport around it, so rows added above the row and
a viewport that shrinks both bring it back into view. Wheeling or dragging
changes neither box, so the offset a player scrolls to is kept until focus
moves. `align` defaults to `"nearest"`, which leaves a fully visible element
where it is. `scrollIntoView` needs one layout pass to have run: before that
the call does nothing and a development build warns, naming the view. It
throws when `element` is not inside the view, or when `padding` is not finite
or is negative.

### Nested scopes

A `focus` panel inside another scope takes the input while it is shown, and
the outer scope's navigation stops at it, so a confirm dialog's rows never
appear in the menu behind it. Hiding the dialog hands input back to the menu
on the row the menu had. Nesting is unlimited.

One scope reads input at a time. It sits in the topmost scene on the stack
that holds a shown scope, counting a scene the game has paused. Within that
scene, a scope holding another shown scope in its subtree does not read input,
so a dialog nested in a menu takes it. Between shown scopes where neither
holds the other, the one shown most recently wins. Hiding a surface, or
disabling its component or entity, hands input back to the next shown scope.
Two scopes shown in the same frame resolve by registration order.

### The scope reading input owns the pointer

Everything drawn under the scope that holds the keys stops answering the
pointer, so a confirm dialog cannot be clicked through: a menu row behind it
reports no hover, takes no press and runs no click, and a press on the blocked
area is claimed for the UI rather than reaching the game's action map. The
scope's own subtree keeps every pointer behaviour it has, and a scope nested
inside another blocks only what is outside itself — a dialog inside a menu
blocks the menu, and a scope inside the dialog blocks the dialog too.

The pointer comes back when the scope stops reading input, is hidden, or is
destroyed. `modal: false` leaves the pointer alone, for a panel that wants the
keys while the world behind it stays clickable:

```ts
menu.panel({ focus: { onCancel: close, modal: false } });
scope?.setOptions({ modal: false }); // takes effect at once
```

Two things to expect. A row already hovered when the dialog appears keeps its
hover look until the pointer next moves, because the hit test runs on a
pointer event and on nothing else; the first move clears it. And a scope
blocks downwards from where it is drawn, so anything drawn above it stays
interactive — a floating overlay, a tooltip, a `PixiSelect` list, or a second
surface added after the menu's.

A container that clips what it draws — a `UIScrollView`, or any other masked
container — clips the block along with everything else inside it. A dialog
opened inside a scroll view covers that view's own rows and leaves every point
outside the view clickable. A dialog that has to cover the screen goes in a
surface of its own, outside the clip.

### Driving a scope directly

```ts
const scope = menu.focusScope;
scope?.move("down"); // true when the press was used: a move, an adjust, an open list
scope?.focus(element); // false when hidden, disabled or not focusable
scope?.focus(null); // clear
scope?.activate();
scope?.cancel();
scope?.setOptions({ wrap: false }); // applied per key present
scope?.focused; // UIElement | null
scope?.hasInput; // whether this scope is the one reading input
scope?.candidates; // readonly UIElement[], tree order
```

`focus(element)` throws when the element is not a descendant of the scope.
Every method above works with no device attached, which is what a cutscene, a
radial menu and a unit test use. While an element under the scope holds its
input, `move`, `activate` and `cancel` go to that element — the device path
and the code-driven path are one, so a headless scope walks an open list the
way a gamepad does.

`focus: { input: null }` reads no device at all and waits for those calls,
while pointer focus, the scroll follow and pointer ownership keep working —
such a scope still holds the keys, so add `modal: false` where the world
behind it must stay clickable. With `@yagejs/input` absent every scope behaves
that way, and a development build warns once.

### `@pixi/ui` wrappers

All six interactive wrappers accept focus, and read `focusStyle` the way the
first-party elements do. Where a style asks for an outline, a wrapper draws it
around what the player sees. A widget layout resizes — `PixiFancyButton`,
`PixiSlider`, `PixiInput` — is framed over the union of its layout box and
what it draws, so a part that escapes the box is framed with the rest. A
composite that places its own parts — `PixiCheckbox`, `PixiRadioGroup`,
`PixiSelect` — keeps its own size inside whatever box layout gives it, and is
framed around that size, so a stretched row leaves no outline hanging past the
widget. `PixiSlider` states its own box — the knob's whole travel — so one
rectangle frames the track and the handle at every value, and the outline
holds still while the value sweeps. `PixiSelect` states the closed button's
box, which the outline keeps while the list is open. The outline is excluded
from measurement, so focusing a widget does not resize it.

| Wrapper           | Confirm                                  | Left / right                         |
| ----------------- | ---------------------------------------- | ------------------------------------ |
| `PixiFancyButton` | emits the button's press                 | —                                    |
| `PixiCheckbox`    | toggles `checked`                        | —                                    |
| `PixiSlider`      | nothing                                  | steps `value` by the widget's `step` |
| `PixiSelect`      | opens the list, then commits the lit row | steps the selection while closed     |
| `PixiRadioGroup`  | nothing                                  | steps a horizontal group             |
| `PixiInput`       | starts editing                           | —                                    |

A stepper returns the press to navigation at either end, so a slider at its
maximum releases focus on a further right press rather than trapping it. A
`PixiRadioGroup` with `type: "vertical"` steps on up and down instead.

### An element holding the scope's input

An element that answers the player on its own while it is focused takes the
scope's input, and the scope hands it all six roles rather than navigating.
Two elements do so: a `PixiInput` holding the caret, and a `PixiSelect`
showing its list. A direction the element has no use for is kept rather than
passed on, so a press can never walk the menu behind it.

```ts
import { isCapturingInput } from "@yagejs/ui";

isCapturingInput(nameField); // true while the field holds the caret
isCapturingInput(displaySelect); // true while its list is open
```

`isCapturingInput` answers per element, so an element holding one scope's
input says nothing about another surface. A game polls it to leave its own
hotkeys alone while the player is typing or picking from a list.

**A `PixiSelect` with its list open.** Up and down move the row a confirm
press commits and the list scrolls to follow, stopping at either end rather
than wrapping. Confirm commits that row — the value changes, `onSelect` fires
once, both labels are rewritten and the list closes — which is the path
clicking that row takes. Cancel closes the list on the value the select
already had and never reaches the scope's `onCancel`. Left and right do
nothing at all while the list shows: the open list holds every direction the
scope reads and acts on up and down alone, so the row's own `onAdjust` runs
only once the list is closed. The list closes and hands the keys back
whenever the select stops being what the player is on: focus moves, the
select is hidden or disabled, the scope stops reading input, or the widget is
destroyed.

**A `PixiInput` with the caret** — `field.isEditing`. Confirm stops editing
and commits; cancel restores the value captured when editing began and then
stops, which `cancelEditing()` also does. Enter and Escape typed into the
field are those same two ends, so a player who renames a save and presses
Escape gets the old name back whether the key reached the field or the menu
around it. The scope taking its input back —
focus moving away, the menu hiding — ends the edit keeping what was typed, the
end a click elsewhere gives it. Every path emits the field's `onEnter`,
because that is what ends every edit. A key typed into the field is text
entry, not game input: it never becomes an action press, so a letter bound to
a gameplay action stays quiet until the player leaves the field.

An element of your own joins the same way: implement `UIInputCaptureElement`
and call `captureFocusInput(this, true)` while it holds the keys, `false` when
it lets go.

```ts
import { captureFocusInput } from "@yagejs/ui";
import type { UIInputCaptureElement } from "@yagejs/ui";

interface UIInputCaptureElement extends UIElement {
  confirmCapture(): void; // stop, keeping what was typed or picked
  cancelCapture(): void; // stop, putting back the value held on taking the input
  releaseCapture(): void; // the scope is taking its input back
  moveCapture?(direction: FocusDirection): void; // omitted: directions are kept, unused
}
```

## Floating UI (tooltips / popovers / menus)

`UIPlugin` provisions one scene-scoped `FloatingOverlay` per scene — a
top-most, screen-space surface that floating elements attach to. It draws
above all other UI, escapes any `<ScrollView>` clip, never reflows siblings,
and anchors correctly even for world-space / camera-transformed triggers
(e.g. a `ScreenFollow` namecard). A `FloatingOverlaySystem` (registered by
`UIPlugin`, `Phase.LateUpdate` priority `201` — after `UILayoutSystem`)
re-anchors every active scene's overlay each frame. **No `<UIRoot>` or React
is required** — this works in a pure imperative scene.

### attachTooltip (imperative, headless)

```ts
import { attachTooltip, UIPanel, UIText } from "@yagejs/ui";

const tip = attachTooltip(surface.root, scene, {
  // any UIElement
  content: () => {
    const card = new UIPanel({
      padding: 6,
      gap: 4,
      background: { color: 0x111827, alpha: 0.95, radius: 6 },
    });
    card.addElement(
      new UIText({ children: "Goblin", style: { fontSize: 13 } }),
    );
    card.addElement(
      new UIText({ children: "HP 100/100", style: { fontSize: 11 } }),
    );
    return card;
  },
  placement: "top", // Placement: side or side-align (default "top", centered)
  offset: 8, // px gap between trigger and bubble (default 6)
  maxWidth: 200, // px; content wraps + clamps to available space
});
// Activation is yours — connect it on hover (the usual case):
surface.setPointerHandlers({ onHover: tip.setActive }); // entity-mounted surface
// a child element instead? element.update({ onHover: tip.setActive })
// Optional: tip.dispose(); // destroying the anchor also releases the slot
```

`attachTooltip` builds the floating parts and returns a `{ setActive, dispose }`
controller — it **registers no input itself**, so it can't overwrite the anchor's
handlers. `anchor` is any `UIElement` (`UIButton`, `UIImage`, a nested
`UIPanel`, …), read only for positioning; for an entity-mounted surface pass
`surface.root`. Drive it yourself: set `onHover` on a surface via
`surface.setPointerHandlers({ onHover: tip.setActive })`, or on an element
via `element.update({ onHover: tip.setActive })` — or trigger from focus /
long-press / a programmatic call.
Setting `onHover` _replaces_ that single slot (which is what you want when the
anchor has none). If it already handles hover, compose (`onHover: (h) => {
existing(h); tip.setActive(h); }`). `content` is a factory, called once, and
headless. Return a styled node for visuals — nothing is added automatically.
`setActive` stays a no-op after `dispose()`, so a lingering hover handler is
harmless. Destroying the anchor disposes the tooltip automatically. You can
still call `dispose()` earlier when the tooltip has a shorter lifetime.
Requires the scene to have the `FloatingOverlay` (i.e. `UIPlugin` is
registered); throws otherwise. The bubble flips to the opposite side and
shifts along the cross axis to stay on-screen, and z-stacks above other floats
on each (re)open.

### Escape hatches

For custom popovers / menus, use the lower-level pieces directly:

- `scene.use(FloatingOverlayKey).acquire()` → a
  `FloatingHandle` with `setReference(get)`, `setConfig(FloatConfig)`,
  `setLayout(fn)`, `invalidateLayout()`, `setActive(bool)`,
  `bringToFront()`, `release()`, and a `container` to add content to.
  The overlay caches layout while the reference geometry, config, and
  viewport stay the same. Call `invalidateLayout()` after changing
  imperative content without replacing its layout callback.
  `FloatingOverlayKey` is a scene-scoped `ServiceKey`; resolve it on the
  scene first, then call `acquire()` on the resulting `FloatingOverlay`.
- `computePosition(reference, floating, viewport, config)` — the pure
  positioning engine (`offset → flip → shift → size`), no Pixi / engine
  deps. Returns `{ x, y, placement, available }`. `Placement` / `Side` /
  `Align` / `Rect` / `Dimensions` are exported.
- `layoutFloat(nodes, maxWidth)` — shrink-to-content layout of a UI node
  stack (what a `setLayout` callback feeds the overlay).

The React layer (`@yagejs/ui-react`) builds `<Tooltip>` / `useFloating` on
this exact overlay.

## Background Options

```ts
// Solid color
{ color: 0x222222, alpha: 0.9, radius: 8 }

// Nine-slice texture
{ texture: tex, mode: "nine-slice", nineSlice: { left: 12, top: 12, right: 12, bottom: 12 } }
```

`UIImage`, `UINineSlice`, and texture backgrounds accept `TextureInput`: a
registered asset key, a texture handle, or a raw renderer texture.

`nineSlice` insets are read from the options, not from the texture's own
metadata, and they are applied every time the options are set. Pass `mode` and
`nineSlice` again whenever you set a new `texture`. Options you leave out go
back to their defaults: a background updated without `nineSlice` draws with
insets of 0, and one updated without `mode` becomes a stretched sprite.

Give a nine-slice element room for its insets: below `left + right` px wide or
`top + bottom` px tall it has no middle row or column and the corners overlap.
Development builds warn when that happens, and warn again if the element later
fits and then shrinks below its insets once more.
