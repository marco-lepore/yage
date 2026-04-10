# @yage/tilemap

Tile-based map loading and rendering for the [YAGE](https://yage.dev) 2D game engine.

## Install

```bash
npm install @yage/tilemap
```

Supports [Tiled](https://www.mapeditor.org/) map format out of the box. Bundles `@pixi/tilemap` for efficient rendering.

## Usage

```ts
import { Engine } from "@yage/core";
import { TilemapPlugin, TilemapComponent, tiledMap } from "@yage/tilemap";

const engine = new Engine();
engine.use(new TilemapPlugin());
```

Load and render a Tiled map:

```ts
const map = await assets.load(tiledMap("level1.json"));
entity.add(new TilemapComponent({ map }));
```

## What's in the box

- **TilemapPlugin / TilemapComponent** - tile-based map rendering
- **Tiled loader** - JSON format support with tilesets, object layers, properties
- **Collision extraction** - convert map shapes to `@yage/physics` colliders (optional)
- **Custom properties** - typed access to Tiled object properties

## Docs

Full documentation at [yage.dev](https://yage.dev).

## License

MIT
