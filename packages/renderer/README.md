# @yagejs/renderer

PixiJS v8 rendering pipeline, sprites, graphics, and cameras for the [YAGE](https://yage.dev) 2D game engine.

## Install

```bash
npm install @yagejs/renderer
```

Bundles PixiJS v8 - no separate install required.

## Usage

```ts
import { Engine } from "@yagejs/core";
import { RendererPlugin, SpriteComponent, GraphicsComponent } from "@yagejs/renderer";

const engine = new Engine();
engine.use(new RendererPlugin({
  width: 800,
  height: 600,
  backgroundColor: 0x0a0a0a,
  container: document.getElementById("game")!,
}));
await engine.start();
```

## What's in the box

- **RendererPlugin** - boots PixiJS, registers stage/camera/layers
- **SpriteComponent / AnimatedSpriteComponent** - static and animated sprites
- **GraphicsComponent** - vector drawing via PixiJS Graphics
- **Camera** - follow, shake, bounds, virtual resolution scaling
- **RenderLayer** - named layers with z-ordering
- **Texture helpers** - `texture()`, `spritesheet()`, `sliceSheet()` for assets

## Docs

Full documentation at [yage.dev](https://yage.dev).

## License

MIT
