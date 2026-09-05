# @yagejs/ui-react

React bindings for building game UI with JSX in the [YAGE](https://yage.dev) 2D game engine.

## Install

```bash
npm install @yagejs/ui-react react react-dom
```

React is a **peer dependency** - bring your own (^18 or ^19).

## Usage

```tsx
import { Engine, Entity, Scene } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { UIPlugin, Anchor } from "@yagejs/ui";
import { UIReactPlugin, UIRoot, Panel, Text, Button } from "@yagejs/ui-react";

function HUD({ score }: { score: number }) {
  return (
    <Panel direction="row" gap={16}>
      <Text style={{ fontSize: 32, fill: 0xffffff }}>{`Score: ${score}`}</Text>
      <Button onClick={() => console.log("pause")}>Pause</Button>
    </Panel>
  );
}

class GameScene extends Scene {
  readonly name = "game";
  onEnter() {
    const hud = this.spawn(Entity);
    const root = hud.add(new UIRoot({ anchor: Anchor.TopCenter }));
    root.render(<HUD score={0} />);
  }
}

const engine = new Engine();
engine.use(new RendererPlugin({ width: 800, height: 600 }));
engine.use(new UIPlugin());
engine.use(new UIReactPlugin());
await engine.start();
await engine.scenes.push(new GameScene());
```

## What's in the box

- **Custom React reconciler** - renders React trees to `@yagejs/ui` widgets
- **JSX components** - `Panel`, `Text`, `Button`, `Image`, `ProgressBar`, and more
- **Hooks-friendly** - use `useState`, `useEffect`, custom hooks for UI state

## Docs

Full documentation at [yage.dev](https://yage.dev).

## License

MIT
