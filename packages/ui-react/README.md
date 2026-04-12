# @yagejs/ui-react

React bindings for building game UI with JSX in the [YAGE](https://yage.dev) 2D game engine.

## Install

```bash
npm install @yagejs/ui-react react react-dom
```

React is a **peer dependency** - bring your own (^18 or ^19).

## Usage

```tsx
import { Engine } from "@yagejs/core";
import { UIPlugin } from "@yagejs/ui";
import { createUIRoot, Panel, Text, Button } from "@yagejs/ui-react";

const engine = new Engine();
engine.use(new UIPlugin());
await engine.start();

function HUD({ score }: { score: number }) {
  return (
    <Panel anchor="TopCenter" direction="row" gap={16}>
      <Text fontSize={32} fill={0xffffff}>Score: {score}</Text>
      <Button onPress={() => console.log("pause")}>Pause</Button>
    </Panel>
  );
}
```

## What's in the box

- **Custom React reconciler** - renders React trees to `@yagejs/ui` widgets
- **JSX components** - `Panel`, `Text`, `Button`, `Image`, `ProgressBar`, and more
- **Hooks-friendly** - use `useState`, `useEffect`, custom hooks for UI state

## Docs

Full documentation at [yage.dev](https://yage.dev).

## License

MIT
