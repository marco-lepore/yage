# @yagejs/ui-react

Depends on `@yagejs/ui`, `react`. React reconciler over the UI system.

## Setup

```ts yage-context="engine"
import { UIPlugin } from "@yagejs/ui";
import { UIReactPlugin } from "@yagejs/ui-react";

engine.use(new UIPlugin());
engine.use(new UIReactPlugin());
```

`UIReactPlugin` registers `UIRootLayoutSystem` in `LateUpdate` so `UIRoot` layouts run after Update-phase Transform writers (e.g. `ScreenFollow`). Required alongside `UIPlugin`.

## UIRoot

```tsx yage-context="entity"
import { UIRoot, Text } from "@yagejs/ui-react";
import { Anchor } from "@yagejs/ui";

function MyComponent() {
  return <Text>Paused</Text>;
}

const root = new UIRoot({
  anchor: Anchor.Center,
  offset: { x: 0, y: 0 },
  layer: "ui", // optional; defaults to auto-provisioned "ui" (screen-space)
  positioning: "anchor", // "anchor" (default) | "transform"
});
entity.add(root);
root.render(<MyComponent />);
```

`root.setOffset(x, y)` moves the tree without touching its anchor, and `root.offset` reads the pair back. Both values must be finite; `NaN` or an infinity throws and names the argument.

Positioning modes (mirror `@yagejs/ui`'s `UISurface`):

- `positioning: "anchor"` (default) — `anchor` resolves against the viewport.
- `positioning: "transform"` — tree is pinned to `entity.get(Transform).worldPosition` in the target layer's local coord space; `anchor` is the pivot on the rendered tree. Throws at add time if the entity has no `Transform`.

For entity-anchored React UI (nameplates, health bars), pair `positioning: "transform"` with a `ScreenFollow` component (`@yagejs/renderer`) that writes `cam.worldToScreen(target) + offset` to this entity's Transform each frame (offset is in screen pixels, applied post-projection). The UI lives on a screen-space layer, stays axis-aligned and constant-size under any camera zoom/rotation.

## JSX Components

```tsx
import {
  Panel,
  ZStack,
  Text,
  Button,
  Image,
  ProgressBar,
  Checkbox,
} from "@yagejs/ui-react";
import { texture } from "@yagejs/renderer";

const iconTex = texture("icons/save.png");

<Panel
  direction="column"
  gap={8}
  padding={16}
  bg={{ color: 0x000000, alpha: 0.7 }}
>
  <Text style={{ fontSize: 24, fill: 0xffffff }}>Hello</Text>

  {/* width/height are optional — omit to shrink-to-content */}
  <Button bg={{ color: 0x4444aa }} onClick={() => {}}>
    Click
  </Button>

  {/* Button accepts ReactNode children for icon + label compositions.
      A button lays out a column, so a row needs direction="row". */}
  <Button direction="row" onClick={() => {}}>
    <Image texture={iconTex} width={16} height={16} />
    <Text>Save</Text>
  </Button>

  <ProgressBar
    width={200}
    height={16}
    value={0.75}
    fillBackground={{ color: 0x44cc44 }}
  />
  <Checkbox label="Mute" checked={false} onChange={(v) => {}} />
  <Image texture={iconTex} width={32} height={32} />
</Panel>;
```

`<Text>` takes a single string child. Pre-join interpolated content into one template string (`` `Boats: ${count}/3` ``); mixing text and expressions (`Boats: {count}/3`) produces a `(string | number)[]` and fails typechecking. `<Button>`, by contrast, accepts arbitrary `ReactNode` children.

`<ProgressBar>` forwards a `ref` to its `UIProgressBar` node, so `ref.current.value` reads the fraction it last drew.

PixiUI wrappers: `PixiFancyButton`, `PixiCheckbox`, `PixiProgressBar`, `PixiSlider`, `PixiInput`, `PixiSelect`, `PixiRadioGroup`.

Each JSX prop type extends its `@yagejs/ui` imperative counterpart (e.g. `ButtonProps` extends `UIButtonProps`). A prop the imperative class accepts is always a valid JSX prop too. `consumeInput` works on every element, including `Checkbox`, `ScrollView`, and the Pixi\* wrappers.

**Prop removal resets to default.** Dropping a prop between renders resets it instead of leaving the old value: a cleared `background` removes the fill on `Panel` and `ScrollView` and returns `Button` to its default grey, an unbound handler stops firing, a removed layout value (`width`, `margin`, and the rest) goes back to its Yoga default. This applies to every element. Two JSX patterns both drop a prop this way: an explicit `undefined` (`bg={selected ? hl : undefined}`) and a conditional spread (`{...(open ? { onClick } : {})}`).

**`bg` is shorthand for `background`** on `Panel`, `Button`, and `ScrollView`. `Button` also has `hoverBg` and `pressBg` for its hover/press backgrounds. Passing both `bg` and `background` on the same element resolves to `background` and fires a dev warning once per element type. `PixiProgressBar`, `PixiSlider`, and `PixiInput` have their own `bg` prop — a required `@pixi/ui` view-slot value, not this alias — and are unaffected.

Removing an element destroys it: a child removed from a container, or the whole `<UIRoot>` tree torn down, frees its Yoga node and Pixi display objects. `destroy()` is idempotent.

## Scrolling lists

`<ScrollView>` is the scroll primitive for any list that can outgrow its container — inventories, quest logs, chat, order panels, leaderboards. A plain `<Panel>` clips overflow silently. `<ScrollView>` adds wheel + drag scrolling and is a true Yoga container: children are normal elements, not handed to a foreign widget. It also **preserves scroll position across re-renders** — fulfilling/refilling a store-driven list does not jump the scroll.

```tsx
import { ScrollView, Panel, Button, Text } from "@yagejs/ui-react";

interface OrdersProps {
  orders: Array<{ id: string; label: string }>;
  fulfill: (id: string) => void;
  endDay: () => void;
}

function OrdersPanel({ orders, fulfill, endDay }: OrdersProps) {
  return (
    <Panel direction="column" width={300} height={220} gap={10} padding={10}>
      <Text style={{ fontSize: 16, fill: 0x93c5fd }}>Orders</Text>

      <ScrollView flexGrow={1} gap={6} bg={{ color: 0x0b1220 }}>
        {orders.map((o) => (
          <Panel
            key={o.id}
            direction="row"
            height={36}
            bg={{ color: 0x243042 }}
          >
            <Text style={{ fontSize: 14, fill: 0xe5e7eb }}>{o.label}</Text>
            <Button height={24} onClick={() => fulfill(o.id)}>
              Fulfill
            </Button>
          </Panel>
        ))}
      </ScrollView>

      {/* Sibling of <ScrollView> → stays fixed while the list scrolls. */}
      <Button height={36} onClick={endDay}>
        End Day
      </Button>
    </Panel>
  );
}
```

Size the viewport with `LayoutProps` (`height` / `flexGrow`). Content overflowing the scroll axis is clipped and pannable (wheel + drag work anywhere over the box, including gaps and the gutter). Dragging starts after 10 px and does not activate a child button when released. Props: `direction` (`"vertical"` default / `"horizontal"`), `gap`, `padding`, `bg`, `onScroll(offset)`, the three hover callbacks (`onHover`, `onPointerOver`, `onPointerOut`, firing anywhere over the box), and `scrollbar` — `true` (default) / `false`, or a `ScrollbarOptions` object (`thickness`, `color`, `alpha`, `radius`, `minThumbLength`, `margin`). When the scrollbar is shown a gutter equal to the thumb footprint is auto-reserved so content never sits under it (`node.scrollbarGutter` is the px). Keep fixed elements (a footer button, a header) as **siblings** of `<ScrollView>`, not children. A `ref` exposes `scrollBy()` / `scrollTo()` / `scrollOffset` / `maxScroll`. The same node is available without React via the `UIPanel` / `UISurface` `.scrollView(opts)` builder.

> Appending JSX children to a layout-leaf element (one with no `addElement`, e.g. `<PixiSelect>`) silently drops them. The reconciler emits a one-shot dev `console.warn` pointing you at `<ScrollView>` / a container.

### ZStack (Z-axis overlay primitive)

`<ZStack>` is a `<Panel>` that defaults to filling its parent
(`width: "100%"`, `height: "100%"`) with `position: "relative"`, so
children declared `position="absolute"` layer on the Z axis. Useful for
modal backdrops, HUD layers, and badge markers. The name follows the
SwiftUI convention (`VStack` / `HStack` / `ZStack`). For column / row
stacking use `<Panel direction="column" | "row">`.

```tsx
import { Panel, Text, ZStack } from "@yagejs/ui-react";

<ZStack>
  <Panel
    position="absolute"
    left={0}
    top={0}
    bg={{ color: 0x000000, alpha: 0.6 }}
  />
  <Panel position="absolute" top={16} right={16} padding={4}>
    <Text>Score: 42</Text>
  </Panel>
</ZStack>;
```

### Absolute positioning

`LayoutProps` (every component) accepts `position`, `left`, `top`,
`right`, `bottom`:

```tsx
import { Panel } from "@yagejs/ui-react";

<Panel position="relative" width={400} height={300}>
  <Panel position="absolute" left={10} top={20} width={50} height={30} />
</Panel>;
```

`position` defaults to `"relative"`. Set `"absolute"` to lift the element out
of the flex flow. `left` / `top` / `right` / `bottom` are offsets against the
nearest relative ancestor: a number is px, a `"<n>%"` string resolves
against the containing block (so `top="100%"` is flush below it).

`Panel` accepts `consumeInput?: boolean` (default `true`). The UI
auto-consume fallback claims pointer events that land on the panel, so they
don't leak through to gameplay actions. Set `false` for a decorative /
pass-through container (e.g. a full-screen overlay) that should let clicks
reach elements beneath it. It does not block the panel's own
hover/click callbacks (those still fire), and a `<Tooltip>` trigger placed
under such a panel still works. The `<Tooltip>` overlay and its bubbles use
`consumeInput={false}` so they never block input to the UI behind them.

### Scale, rotation and draw order

Every component takes `transformOrigin` (fractions of its size, default `0`),
`scale` (number or `{ x, y }`, default `1`), `rotation` (radians) and `zIndex`
(order among siblings, default `0`). They change how it is drawn, never its
layout box; `ui.md` "Scale, rotation and draw order" has the rules for
clipping, scrolling and draw order.

```tsx
import { useState } from "react";
import { Panel } from "@yagejs/ui-react";

const [hovered, setHovered] = useState(false);

<Panel
  width={120}
  height={160}
  transformOrigin={0.5}
  scale={hovered ? 1.08 : 1}
  zIndex={hovered ? 1 : 0}
  onHover={setHovered}
/>;
```

Every render passes each prop again, so a `scale` prop replaces a value written
to the element another way. Animate through state: a scene-scoped tween
(`makeSceneScopedQueue(engine.resolve(ProcessSystemKey), scene)` from
`useEngine()` / `useScene()`) writing the scale into component state pops a
dialog in over a few frames. Removing a prop resets it: `scale` to `1`, `transformOrigin` to `0`.

### Hover events

`Panel`, `Button`, `Text`, `SplitText`, `Image`, `NineSlice`, `ProgressBar`,
`Checkbox`, `ScrollView` and the interactive `Pixi*` wrappers accept hover
callbacks (the container is already interactive, so these need no new
listeners). Three independent, combinable props:

- `onPointerOver?: () => void` / `onPointerOut?: () => void` — mirror Pixi
  events and the existing `onClick` naming; use when enter / leave need
  separate handlers.
- `onHover?: (hovering: boolean) => void` — convenience: `true` on enter,
  `false` on leave. Ideal for "show while hovered" toggles.

```tsx
import { Button, Panel } from "@yagejs/ui-react";

declare function save(): void;
declare function setGlow(hovering: boolean): void;
declare function preview(): void;
declare function clearPreview(): void;

<Button onClick={save} onHover={setGlow}>
  Save
</Button>;
<Panel onPointerOver={preview} onPointerOut={clearPreview}>
  …
</Panel>;
```

Callbacks are suppressed on a component with a disabled state while that
state is on: `<Button>`, `<Checkbox>`, and a `Pixi*` wrapper whose widget
carries an enabled flag.

### Keyboard and gamepad focus

Every JSX prop type derives from its imperative counterpart, so the focus
props arrive with no separate declaration: `focusable`, `focusId`,
`focusNeighbors`, `onFocusChange`, `onAdjust` and `focusStyle` on every
component, and `focus` on `<Panel>` — whose keys include `wrap`, `autoFocus`,
`input`, `pointerFocus`, `modal`, `scrollPadding` and the scope-wide cue
callbacks. Full behaviour: the focus section of `llms/packages/ui.md`.

```tsx
import { useState } from "react";
import { Button, Checkbox, Panel, Text } from "@yagejs/ui-react";

declare function close(): void;
declare function resume(): void;
declare function upload(): void;

const [volume, setVolume] = useState(60);
const [music, setMusic] = useState(true);

<Panel gap={8} focus={{ wrap: true, onCancel: close }}>
  <Button width={220} onClick={resume}>
    Resume
  </Button>
  <Button width={220} disabled onClick={upload}>
    Upload
  </Button>

  <Panel
    direction="row"
    focusable
    focusId="volume"
    focusNeighbors={{ down: "saves-first" }}
    onAdjust={(d) => setVolume((v) => v + d * 5)}
  >
    <Text>{`Volume ${volume}`}</Text>
  </Panel>

  <Checkbox label="Music" checked={music} onChange={setMusic} />
</Panel>;
```

**Focus draws nothing until a game asks for it.** `onFocusChange` is where
most games show it — a marker beside the row, a swapped sprite, a sound:

```tsx
import { useState } from "react";
import { Button, Panel, Text } from "@yagejs/ui-react";

declare function resume(): void;

const [focusedId, setFocusedId] = useState<string | null>(null);

<Panel direction="row" gap={6}>
  <Text width={10}>{focusedId === "continue" ? ">" : ""}</Text>
  <Button
    flex={1}
    onFocusChange={(focused) => setFocusedId(focused ? "continue" : null)}
    onClick={resume}
  >
    Continue
  </Button>
</Panel>;
```

`focusStyle` asks for the package's own outline, drawn just inside the
component's box, with `color`, `width`, `radius` and `inset` on one component
over the `focusStyle` given to `UIPlugin` for the whole UI. `focusStyle={null}`
on a component drops a UI-wide outline for that component alone. Hover and
press keep their fills, so a row the pointer is on shows both.

`focusBg` fills the row that holds the focus. `<Button>` takes it beside
`hoverBg` and `pressBg`, and a `focusable` `<Panel>` takes it on its own: a
panel with no `bg` is transparent at rest and filled while the focus is on it.
Omitted, a focused component keeps its resting background. A fill naming only
a colour keeps the resting corner radius.

```tsx
import { Panel, Text } from "@yagejs/ui-react";

declare const slot: { label: string; playtime: string };

<Panel
  direction="row"
  gap={6}
  padding={4}
  focusable
  focusBg={{ color: 0x2c4a6f, radius: 4 }}
>
  <Text>{slot.label}</Text>
  <Text>{slot.playtime}</Text>
</Panel>;
```

**The pointer and focus are separate.** Pressing a component focuses it;
passing the pointer over one leaves focus where the keyboard put it.
`focus={{ pointerFocus: "hover" }}` restores the console-style lit row, and
`"none"` keeps the pointer out of focus entirely.

**The scope reading input owns the pointer.** While a `focus` panel holds the
keys, everything drawn under it stops answering the pointer, so a confirm
dialog cannot be clicked through. A `<ScrollView>`, or any other container
that clips what it draws, clips the block too: a `focus` panel inside one
covers that view's own rows and leaves every point outside the view clickable.
`focus={{ modal: false }}` turns it off.

Holding confirm on the focused component paints it pressed and runs its action
on the release; letting go after moving the focus away runs nothing.

**Re-rendering with a fresh `focus` object refreshes the scope's options in
place.** The reconciler passes every prop on every commit, so a new object
literal each render is the normal case and focus stays where it is. Put the
menu's callbacks in `focus` — `onCancel`, `onFocusMove`, `onActivate`,
`onMoveBlocked` — and they are replaced per render without rebuilding
anything. The object is the whole declaration: a key a render leaves out goes
back to its default, so a callback you stop passing stops running. Dropping the prop, by an explicit `undefined` or a conditional
spread, disposes the scope and hands input to the next shown one.

`UIRoot` takes the same option, for a tree whose outermost element is not a
single `<Panel>`:

```ts yage-context="entity"
import { UIRoot } from "@yagejs/ui-react";
import { Anchor } from "@yagejs/ui";

const root = entity.add(new UIRoot({ anchor: Anchor.Center, focus: true }));
root.focusScope; // UIFocusScope | null
```

### Tooltip

`<Tooltip content={…}>` wraps a trigger and shows a floating bubble while
hovered (Mantine-style: one wrapper, content in a prop). **Headless** — no
default visuals; pass `bg` / `padding` / `textStyle` to style it. Under a
`<UIRoot>` the bubble is portaled into the scene's top-most screen-space
overlay and anchored by the positioning engine: it draws above all other
UI, escapes a `<ScrollView>` clip, never reflows siblings, **flips** to the
opposite side and **shifts** to stay on-screen, z-stacks across roots
(most-recently-opened on top), and anchors correctly even for world-space /
camera-transformed triggers. Without a `<UIRoot>` overlay it falls back to
an in-tree absolute bubble (no collision handling).

```tsx
import { Button, Image, Panel, Text, Tooltip } from "@yagejs/ui-react";
import { texture } from "@yagejs/renderer";

declare function save(): void;
const swordIcon = texture("items/iron-sword.png");

<Tooltip
  content="Save your game"
  placement="top"
  bg={{ color: 0x1f2430, radius: 6 }}
  padding={8}
>
  <Button onClick={save}>Save</Button>
</Tooltip>;

<Tooltip
  content={
    <Panel gap={2}>
      <Text>+5 ATK</Text>
      <Text>Rare</Text>
    </Panel>
  }
  placement="right"
>
  <Image texture={swordIcon} />
</Tooltip>;
```

Props: `content` (string/number → auto `<Text>`; nodes for rich content),
`placement` (`Placement` — `side` or `side-align`, e.g. `"top"`,
`"bottom-start"`, `"right-end"`; default `"top"`, center-aligned),
`offset` (px gap, default `6`), `maxWidth` (px; content wraps instead of
running off-screen — always also clamped to the space available at the
resolved side), `bg`, `padding`, `textStyle`, `opened` (force visibility,
bypass hover), `disabled` (render trigger only).

### useFloating (headless)

The primitive `<Tooltip>` is built on: `useFloating({ open, placement,
offset, padding, maxWidth, flip, shift })` → `{ setReference(el),
renderFloating(content), hasOverlay }`. Connect `setReference` to the
trigger's ref, render `renderFloating(node)` in your tree (it portals into
the scene overlay while `open`, returns `null` when closed / no overlay).
Use for custom popovers, menus, hovercards. `computePosition()` (the pure
engine: `offset` → `flip` → `shift` → `size`) and `Placement` are exported
for fully custom layers. The scene overlay is a scene-scoped
`FloatingOverlay` provided by `UIPlugin` (so floating UI works with or
without React) and re-anchored each frame by `@yagejs/ui`'s
`FloatingOverlaySystem`. For a non-React scene, use `attachTooltip` from
`@yagejs/ui` directly.

## Hooks

```ts
import {
  Component,
  createCounter,
  createList,
  createMap,
  createRecord,
  createSet,
  createStore,
  createValue,
} from "@yagejs/core";
import {
  useEngine,
  useScene,
  useStore,
  useQuery,
  useSceneSelector,
} from "@yagejs/ui-react";

const record = createRecord({ default: () => ({ hp: 100 }) });
const counter = createCounter();
const map = createMap<string, number>();
const set = createSet<string>();
const list = createList<string>();
const value = createValue({ default: "idle" });
const compound = createStore((s) => ({ gold: s.counter() }));
class EnemyTag extends Component {}

// Engine/scene context
const engine = useEngine();
const scene = useScene();

// Reactive source — one overload per Reactive* shape, plus a selector escape hatch.
useStore(record); // ReactiveRecord<T>      → Readonly<T>
useStore(counter); // ReactiveCounter        → number
useStore(map); // ReactiveMap<K, V>      → Array<[K, V]>
useStore(set); // ReactiveSet<K>         → K[]
useStore(list); // ReactiveList<T>        → T[]
useStore(value); // ReactiveValue<T>       → T
useStore(compound); // ReactiveStore<L>       → encoded snapshot
useStore(record, (src) => src.get().hp); // selector receives the source itself, not a snapshot

// ECS query (polled each frame)
const count = useQuery([EnemyTag], (result) => result.size);

// Scene selector (polled each frame)
const entityCount = useSceneSelector((scene) => scene.getEntities().size);
```

`useStore(compound)` is supported — it returns the encoded snapshot of the whole tree. Reading individual leaves keeps subscription granularity per-leaf. Dispatch is symbol-driven (each shape carries a `[STATE_KIND]` brand from `@yagejs/core`).

`useQuery` registers its `QueryCache` query in an effect on mount and releases it when the component unmounts (`QueryCache.unregister`), so a query does not keep matching new entities after the component is gone. Passing an inline array literal as `filter` (`useQuery([EnemyTag], ...)`) is fine. Re-registration is keyed off the filter's contents, not its identity, so a new array with the same component classes on every render does not churn the registration. Before the effect commits (first paint, or the frame after `filter`'s contents change), reads fall back to `QueryCache.queryOnce`, a detached snapshot seeded with the same currently-matching entities the live query will pick up.

```ts
import { createStore } from "@yagejs/core";
import { useStore } from "@yagejs/ui-react";

const game = createStore((s) => ({
  inventory: s.map<string, number>(),
  gold: s.counter(),
  settings: s.record({ default: () => ({ lang: "en" }) }),
  player: s.record({ default: () => ({ health: 100 }) }),
}));

const inv = useStore(game.inventory); // entries snapshot
const gold = useStore(game.gold); // number
const lang = useStore(game.settings, (s) => s.get().lang); // selector on leaf
const hp = useStore(game, (s) => s.player.get().health); // selector on compound
```

## In-memory record for UI

For ECS↔UI bridges that don't need persistence, use `createRecord` from `@yagejs/core`:

```ts
import { createRecord } from "@yagejs/core";
import { useStore } from "@yagejs/ui-react";

const ui = createRecord({ default: () => ({ score: 0, health: 100 }) });

// ECS side: write
ui.set({ score: ui.get().score + 10 });

// React side: read (auto-rerenders)
const score = useStore(ui, (src) => src.get().score);

// Manual subscribe
const unsub = ui.subscribe(() => console.log(ui.get()));
```
