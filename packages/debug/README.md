# @yagejs/debug

FPS counter, entity inspector, and dev overlays for the [YAGE](https://yage.dev) 2D game engine.

## Install

```bash
npm install @yagejs/debug
```

## Usage

```ts
import { Engine } from "@yagejs/core";
import { DebugPlugin } from "@yagejs/debug";

const engine = new Engine({ debug: true });
engine.use(new DebugPlugin());
```

## What's in the box

- **DebugPlugin** - FPS counter, entity count, and HUD overlays
- **Debug registry** - other packages contribute widgets (physics collider overlay, input state, etc.)
- **Manual clock mode** - deterministic frame-stepping for tests
- **Stats store** - per-frame metrics collection

### For package authors

`@yagejs/debug/api` exposes hooks for other packages to register debug contributors:

```ts
import { DebugRegistryKey } from "@yagejs/debug/api";

const registry = engine.context.resolve(DebugRegistryKey);
registry.registerContributor({ /* ... */ });
```

## Docs

Full documentation at [yage.dev](https://yage.dev).

## License

MIT
