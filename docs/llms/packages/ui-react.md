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

PixiUI wrappers: `PixiFancyButton`, `PixiCheckbox`, `PixiProgressBar`, `PixiSlider`, `PixiInput`, `PixiScrollBox`, `PixiSelect`, `PixiRadioGroup`.

## Scrolling lists

Reach for `PixiScrollBox` for any list that can outgrow its container — inventories, quest logs, chat, order panels, leaderboards. A plain `<Panel>` clips overflow silently; `PixiScrollBox` adds drag + wheel scrolling and works inside the Yoga layout tree.

```tsx
import { PixiScrollBox } from "@yagejs/ui-react";
import { Panel, Text } from "@yagejs/ui-react";

function OrdersPanel({ orders }: { orders: Order[] }) {
  return (
    <PixiScrollBox
      scrollWidth={240}
      scrollHeight={160}
      type="vertical"
      elementsMargin={4}
      background={0x111111}
      radius={6}
    >
      {orders.map((o) => (
        <Panel key={o.id} padding={8} bg={{ color: 0x222233 }}>
          <Text style={{ fontSize: 12, fill: 0xffffff }}>{o.label}</Text>
        </Panel>
      ))}
    </PixiScrollBox>
  );
}
```

`scrollWidth` / `scrollHeight` fix the viewport; children stack inside it and scroll if they overflow. `type` is `"vertical"` (default), `"horizontal"`, or `"both"`. `elementsMargin` is the gap between items, `globalScroll` enables wheel scrolling anywhere over the box. For the underlying widget's full prop surface (mask shape, drag inertia, etc.) see the [`@pixi/ui` ScrollBox docs](https://pixijs.io/ui/storybook/?path=/story/components-scrollbox).

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
of the flex flow; `left` / `top` / `right` / `bottom` are pixel offsets
against the nearest relative ancestor.

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

const ui = createRecord({ defaults: () => ({ score: 0, health: 100 }) });

// ECS side: write
ui.set({ score: ui.get().score + 10 });

// React side: read (auto-rerenders)
const score = useStore(ui, (src) => src.get().score);

// Manual subscribe
const unsub = ui.subscribe(() => console.log(ui.get()));
```
