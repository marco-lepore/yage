# @yagejs/tilemap

Tile-based map loading and rendering for the [YAGE](https://yage.dev) 2D game engine.

## Install

```bash
npm install @yagejs/tilemap
```

Supports [Tiled](https://www.mapeditor.org/) map format out of the box. Bundles `@pixi/tilemap` for efficient rendering.

## Usage

```ts
import { Engine } from "@yagejs/core";
import { TilemapPlugin, TilemapComponent, tiledMap } from "@yagejs/tilemap";

const engine = new Engine();
engine.use(new TilemapPlugin());
```

Load and render a Tiled map:

```ts yage-context="context,entity"
import { AssetManagerKey } from "@yagejs/core";
import { tiledMap, TilemapComponent } from "@yagejs/tilemap";

const level = tiledMap("level1.json");
await context.resolve(AssetManagerKey).loadAll([level]);
entity.add(new TilemapComponent({ source: level }));
```

> **Tileset format:** export tilesets as **JSON** (`.tsj` or `.json`).
> Tiled's default XML `.tsx` format is not supported by the loader. In Tiled,
> use _Edit Tileset → File → Export As → JSON_.

## What's in the box

- **TilemapPlugin / TilemapComponent** - tile-based map rendering
- **Tiled loader** - JSON format support with tilesets, object layers, properties
- **Collision extraction** - convert map shapes to `@yagejs/physics` colliders (optional)
- **Custom properties** - typed access to Tiled object properties

## Docs

Full documentation at [yage.dev](https://yage.dev).

## License

MIT
