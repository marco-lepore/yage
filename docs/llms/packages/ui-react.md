# @yagejs/ui-react

Depends on `@yagejs/ui`, `react`. React reconciler over the UI system.

## Setup

```ts
import { UIPlugin } from "@yagejs/ui";
import { UIReactPlugin } from "@yagejs/ui-react";

engine.use(new UIPlugin());
engine.use(new UIReactPlugin());
```

`UIReactPlugin` registers `UIRootLayoutSystem` in `LateUpdate` so `UIRoot` layouts run after Update-phase Transform writers (e.g. `ScreenFollow`). Required alongside `UIPlugin`.

## UIRoot

```ts
import { UIRoot } from "@yagejs/ui-react";
import { Anchor } from "@yagejs/ui";

const root = new UIRoot({
  anchor: Anchor.Center,
  offset: { x: 0, y: 0 },
  layer: "ui",                   // optional; defaults to auto-provisioned "ui" (screen-space)
  positioning: "anchor",          // "anchor" (default) | "transform"
});
entity.add(root);
root.render(<MyComponent />);
```

Positioning modes (mirror `@yagejs/ui`'s `UIPanel`):
- `positioning: "anchor"` (default) — `anchor` resolves against the viewport.
- `positioning: "transform"` — tree is pinned to `entity.get(Transform).worldPosition` in the target layer's local coord space; `anchor` is the pivot on the rendered tree. Throws at add time if the entity has no `Transform`.

For entity-anchored React UI (nameplates, health bars), pair `positioning: "transform"` with a `ScreenFollow` component (`@yagejs/renderer`) that writes `cam.worldToScreen(target) + offset` to this entity's Transform each frame (offset is in screen pixels, applied post-projection). The UI lives on a screen-space layer, stays axis-aligned and constant-size under any camera zoom/rotation.

## JSX Components

```tsx
import { Panel, ZStack, Text, Button, Image, ProgressBar, Checkbox } from "@yagejs/ui-react";

<Panel direction="column" gap={8} padding={16} bg={{ color: 0x000000, alpha: 0.7 }}>
  <Text style={{ fontSize: 24, fill: 0xffffff }}>Hello</Text>

  {/* width/height are optional — omit to shrink-to-content */}
  <Button bg={{ color: 0x4444aa }} onClick={() => {}}>Click</Button>

  {/* Button accepts ReactNode children for icon + label compositions */}
  <Button onClick={() => {}}>
    <Image texture={iconTex} width={16} height={16} />
    <Text>Save</Text>
  </Button>

  <ProgressBar width={200} height={16} value={0.75} fillBackground={{ color: 0x44cc44 }} />
  <Checkbox label="Mute" checked={false} onChange={(v) => {}} />
  <Image texture={iconTex} width={32} height={32} />
</Panel>
```

PixiUI wrappers: `PixiFancyButton`, `PixiCheckbox`, `PixiProgressBar`, `PixiSlider`, `PixiInput`, `PixiSelect`, `PixiRadioGroup`.

## Scrolling lists

`<ScrollView>` is the scroll primitive for any list that can outgrow its container — inventories, quest logs, chat, order panels, leaderboards. A plain `<Panel>` clips overflow silently; `<ScrollView>` adds wheel + drag scrolling, is a true Yoga container (children are normal elements, not handed to a foreign widget), and **preserves scroll position across re-renders** — fulfilling/refilling a store-driven list does not jump the scroll.

```tsx
import { ScrollView, Panel, Button, Text } from "@yagejs/ui-react";

function OrdersPanel({ orders, fulfill, endDay }: OrdersProps) {
  return (
    <Panel direction="column" width={300} height={220} gap={10} padding={10}>
      <Text style={{ fontSize: 16, fill: 0x93c5fd }}>Orders</Text>

      <ScrollView flexGrow={1} gap={6} bg={{ color: 0x0b1220 }}>
        {orders.map((o) => (
          <Panel key={o.id} direction="row" height={36} bg={{ color: 0x243042 }}>
            <Text style={{ fontSize: 14, fill: 0xe5e7eb }}>{o.label}</Text>
            <Button height={24} onClick={() => fulfill(o.id)}>Fulfill</Button>
          </Panel>
        ))}
      </ScrollView>

      {/* Sibling of <ScrollView> → stays fixed while the list scrolls. */}
      <Button height={36} onClick={endDay}>End Day</Button>
    </Panel>
  );
}
```

Size the viewport with `LayoutProps` (`height` / `flexGrow`); content overflowing the scroll axis is clipped and pannable (wheel + drag work anywhere over the box, including gaps and the gutter). Props: `direction` (`"vertical"` default / `"horizontal"`), `gap`, `padding`, `bg`, `onScroll(offset)`, and `scrollbar` — `true` (default) / `false`, or a `ScrollbarOptions` object (`thickness`, `color`, `alpha`, `radius`, `minThumbLength`, `margin`). When the scrollbar is shown a gutter equal to the thumb footprint is auto-reserved so content never sits under it (`node.scrollbarGutter` is the px). Keep fixed elements (a footer button, a header) as **siblings** of `<ScrollView>`, not children. The same node is available without React via the `PanelNode` / `UIPanel` `.scrollView(opts)` builder, and exposes `scrollBy()` / `scrollTo()` / `scrollOffset` / `maxScroll`.

> Appending JSX children to a layout-leaf element (one with no `addElement`, e.g. `<PixiSelect>`) silently drops them; the reconciler now emits a one-shot dev `console.warn` pointing you at `<ScrollView>` / a container.

### ZStack (Z-axis overlay primitive)

`<ZStack>` is a `<Panel>` that defaults to filling its parent
(`width: "100%"`, `height: "100%"`) with `position: "relative"`, so
children declared `position="absolute"` layer on the Z axis. Useful for
modal backdrops, HUD layers, and badge markers. The name follows the
SwiftUI convention (`VStack` / `HStack` / `ZStack`); for column / row
stacking use `<Panel direction="column" | "row">`.

```tsx
<ZStack>
  <Panel position="absolute" left={0} top={0} bg={{ color: 0x000000, alpha: 0.6 }} />
  <Panel position="absolute" top={16} right={16} padding={4}>
    <Text>Score: 42</Text>
  </Panel>
</ZStack>
```

### Absolute positioning

`LayoutProps` (every component) now accepts `position`, `left`, `top`,
`right`, `bottom`:

```tsx
<Panel position="relative" width={400} height={300}>
  <Panel position="absolute" left={10} top={20} width={50} height={30} />
</Panel>
```

`position` defaults to `"relative"`. Set `"absolute"` to lift the element out
of the flex flow; `left` / `top` / `right` / `bottom` are offsets against the
nearest relative ancestor — a number is px, a `"<n>%"` string resolves
against the containing block (so `top="100%"` is flush below it).

### Hover events

`Panel`, `Button`, `Text`, `Image`, `NineSlice`, `ProgressBar` accept hover
callbacks (the container is already interactive — this is a fan-out, not new
infra). Three independent, combinable props:

- `onPointerOver?: () => void` / `onPointerOut?: () => void` — mirror Pixi
  events and the existing `onClick` naming; use when enter / leave need
  separate handlers.
- `onHover?: (hovering: boolean) => void` — convenience: `true` on enter,
  `false` on leave. Ideal for "show while hovered" toggles.

```tsx
<Button onClick={save} onHover={setGlow}>Save</Button>
<Panel onPointerOver={preview} onPointerOut={clearPreview}>…</Panel>
```

Callbacks are suppressed while a `<Button disabled>`.

### Tooltip

`<Tooltip content={…}>` wraps a trigger and shows a floating bubble while
hovered (Mantine-style: one wrapper, content in a prop). Under a `<UIRoot>`
the bubble is hoisted into the root's top overlay — a viewport-sized,
top-most, unclipped container re-anchored to the trigger every frame — so it
always draws above other UI, escapes a `<ScrollView>` clip, and is sized to
its own content (long labels stay one line). Without a `<UIRoot>` it falls
back to an in-tree absolute bubble. Never reflows siblings.

```tsx
<Tooltip content="Save your game" placement="top">
  <Button onClick={save}>Save</Button>
</Tooltip>

<Tooltip content={<Panel gap={2}><Text>+5 ATK</Text><Text>Rare</Text></Panel>} placement="right">
  <Image texture={swordIcon} />
</Tooltip>
```

Props: `content` (string/number → auto `<Text>`; nodes for rich content),
`placement` (`"top"` default / `"bottom"` / `"left"` / `"right"`), `offset`
(px gap, default `6`), `bg`, `padding`, `textStyle`, `opened` (force
visibility, bypass hover), `disabled` (render trigger only). The bubble is
start-aligned on the cross axis (not centered — centering needs a measured
size; use `<ZStack>` for precise placement).

## Hooks

```ts
import { useEngine, useScene, useStore, useQuery, useSceneSelector } from "@yagejs/ui-react";

// Engine/scene context
const engine = useEngine();
const scene = useScene();

// Reactive source — one overload per Reactive* shape, plus a selector escape hatch.
useStore(record);           // ReactiveRecord<T>      → Readonly<T>
useStore(counter);          // ReactiveCounter        → number
useStore(map);              // ReactiveMap<K, V>      → Array<[K, V]>
useStore(set);              // ReactiveSet<K>         → K[]
useStore(list);             // ReactiveList<T>        → T[]
useStore(value);            // ReactiveValue<T>       → T
useStore(compound);         // ReactiveStore<L>       → encoded snapshot
useStore(source, select);   // selector receives the source itself, not a snapshot

// ECS query (polled each frame)
const count = useQuery([EnemyTag], (result) => result.size);

// Scene selector (polled each frame)
const entityCount = useSceneSelector((scene) => scene.getEntities().length);
```

`useStore(compound)` is supported — it returns the encoded snapshot of the whole tree. Reading individual leaves keeps subscription granularity per-leaf. Dispatch is symbol-driven (each shape carries a `[STATE_KIND]` brand from `@yagejs/core`).

```ts
const inv  = useStore(game.inventory);                          // entries snapshot
const gold = useStore(game.gold);                               // number
const lang = useStore(game.settings, (s) => s.get().lang);      // selector on leaf
const hp   = useStore(game, (s) => s.player.get().health);      // selector on compound
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
