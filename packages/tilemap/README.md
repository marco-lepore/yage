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

```ts
import { Scene, Transform } from "@yagejs/core";
import { TilemapComponent, tiledMap } from "@yagejs/tilemap";

const Level1 = tiledMap("level1.json");

class LevelScene extends Scene {
  readonly name = "level";
  readonly preload = [Level1]; // loads the map and its tileset images

  onEnter() {
    const map = this.spawn("map");
    map.add(new Transform());
    map.add(new TilemapComponent({ source: Level1 }));
  }
}
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
