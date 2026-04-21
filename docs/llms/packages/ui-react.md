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

For entity-anchored React UI (nameplates, health bars), pair `positioning: "transform"` with a `ScreenFollow` component (`@yagejs/renderer`) that writes `cam.worldToScreen(target + offset)` to this entity's Transform each frame. The UI lives on a screen-space layer, stays axis-aligned and constant-size under any camera zoom/rotation.

## JSX Components

```tsx
import { Panel, Text, Button, Image, ProgressBar, Checkbox } from "@yagejs/ui-react";

<Panel direction="column" gap={8} padding={16} bg={{ color: 0x000000, alpha: 0.7 }}>
  <Text style={{ fontSize: 24, fill: 0xffffff }}>Hello</Text>
  <Button width={150} height={40} bg={{ color: 0x4444aa }} onClick={() => {}}>Click</Button>
  <ProgressBar width={200} height={16} value={0.75} fillBackground={{ color: 0x44cc44 }} />
  <Checkbox label="Mute" checked={false} onChange={(v) => {}} />
  <Image texture={iconTex} width={32} height={32} />
</Panel>
```

PixiUI wrappers: `PixiFancyButton`, `PixiCheckbox`, `PixiProgressBar`, `PixiSlider`, `PixiInput`, `PixiScrollBox`, `PixiSelect`, `PixiRadioGroup`.

## Hooks

```ts
import { useEngine, useScene, useStore, useQuery, useSceneSelector } from "@yagejs/ui-react";

// Engine/scene context
const engine = useEngine();
const scene = useScene();

// Reactive store
const score = useStore(store, (s) => s.score);

// ECS query (polled each frame)
const count = useQuery([EnemyTag], (result) => result.size);

// Scene selector (polled each frame)
const entityCount = useSceneSelector((scene) => scene.getEntities().length);
```

## createStore

```ts
import { createStore } from "@yagejs/ui-react";

const store = createStore({ score: 0, health: 100 });

// ECS side: write
store.set({ score: store.get().score + 10 });

// React side: read (auto-rerenders)
const score = useStore(store, (s) => s.score);

// Manual subscribe
const unsub = store.subscribe(() => console.log(store.get()));
```
