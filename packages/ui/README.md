# @yage/ui

In-game UI layout and widgets for the [YAGE](https://yage.dev) 2D game engine.

## Install

```bash
npm install @yage/ui
```

Built on [Yoga](https://yogalayout.dev/) for Flexbox layout and [@pixi/ui](https://pixijs.io/ui/) for widgets.

## Usage

```ts
import { Engine } from "@yage/core";
import { UIPlugin, UIPanel, Anchor } from "@yage/ui";

const engine = new Engine();
engine.use(new UIPlugin());
```

Build panels, text, buttons, and images with Flexbox:

```ts
entity.add(new UIPanel({
  anchor: Anchor.TopCenter,
  direction: "row",
  gap: 16,
}).text("Score: 0", { fontSize: 32, fill: 0xffffff }));
```

## What's in the box

- **UIPlugin** - UI layer management
- **UIPanel** - Flexbox container with Yoga layout
- **UIText / UIButton / UIImage / UINineSlice** - basic widgets
- **UIProgressBar / UICheckbox** - interactive widgets
- **PixiFancyButton, PixiSlider, PixiScrollBox, etc.** - `@pixi/ui` wrappers
- **Anchor points** - viewport-relative positioning

## Docs

Full documentation at [yage.dev](https://yage.dev).

## License

MIT
