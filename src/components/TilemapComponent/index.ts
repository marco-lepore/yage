import { Assets, Texture, Transform } from "pixi.js";
import { CompositeTilemap } from "@pixi/tilemap";
import { Component } from "../BaseComponent";
import { GameObject } from "../../GameObject";
import {
  MapData,
  TileObject,
  TilesetData,
  PhysicsData,
  Property,
  TileLayer,
  ObjectGroup,
  PolygonObject,
  RectangleObject,
} from "./types";
import {
  objectsToRapierCollidersDesc,
  objectToRapierColliderDesc,
} from "./utils";

const getPropertyValue = (properties: Property[], propertyName: string) => {
  const prop = properties.find((p) => p.name === propertyName);
  return prop?.value;
};

const makeTilemap = (
  layer: TileLayer,
  tilesetsData: {
    data: TilesetData;
    firstgid: number;
    source: string;
  }[],
  tileheight: number,
  tilewidth: number
) => {
  // const bodies: Body[] = []
  const tilemap = new CompositeTilemap();
  const { data, width } = layer;
  data.forEach((tile, i) => {
    if (tile === 0) {
      return;
    }

    const tileset = tilesetsData
      .sort(({ firstgid: a }, { firstgid: b }) => (a > b ? 1 : -1))
      .find(({ firstgid }, i) => {
        const nextTileset = tilesetsData[i + 1];
        if (nextTileset) {
          return firstgid <= tile && nextTileset.firstgid > tile;
        } else {
          return firstgid <= tile;
        }
      });

    if (!tileset) {
      throw new Error("invalid tileset for tile gid " + tile);
    }

    const tileData = tileset.data.tiles[tile - tileset.firstgid];
    const x = i % width;
    const y = Math.floor(i / width);
    const textureNameMatch = tileData?.image.match(/[^\/]*$/);
    const textureName = textureNameMatch && textureNameMatch[0];
    if (!textureName) {
      throw new Error("invalid texturename " + textureName);
    }

    /*  const physicsRef = getPropertyValue(tileset.data.properties, 'physics')
    if (physicsRef) {
      const physicsData = Assets.get(physicsRef) as PhysicsData
      const physicsTileRef = textureName.replace(/\..*$/, '')
      const physicsTileData = physicsData[physicsTileRef]
      if (physicsTileData) {
        physicsTileData.fixtures.forEach((fixture) => {
          fixture.vertices.forEach((vertices) => {
            const sorted = Vertices.clockwiseSort(vertices)
            const centre = Vertices.centre(sorted)
            const body = Body.create({
              ...physicsTileData,
              isSensor: fixture.isSensor,
              vertices: sorted,
              type: 'body',
            })

            Body.translate(body, {
              x: x * tilewidth + centre.x,
              y: y * tileheight + centre.y,
            })
            bodies.push(body)
          })
        })
      }
    } */

    const texture = Assets.get(textureName) as Texture;
    if (!texture) {
      throw new Error("invalid texture " + texture);
    }

    tilemap.tile(textureName, x * tilewidth, y * tileheight);
  });

  //return { tilemap, bodies }
  return tilemap;
};

const makeObjects = (
  objects: Record<string, TileObject[]>,
  objectGroup: ObjectGroup
) => {
  objectGroup.objects.forEach((obj) => {
    const c = obj.class;
    if (!objects[c]) {
      objects[c] = [];
    }
    objects[c].push(obj);
  });

  return objects;
};

const parseMapAsset = (mapName: string) => {
  const map = Assets.get(mapName) as MapData;
  if (!map.layers) {
    throw new Error(`${mapName} does not contain tiled map data`);
  }

  const { tilesets } = map;

  const tilesetsData = tilesets.map((tileset) => {
    const tilesetData = Assets.get(tileset.source) as TilesetData;
    return {
      ...tileset,
      data: tilesetData,
    };
  });

  const { tileheight, tilewidth } = map;

  const tilemaps = map.layers
    .filter((l): l is TileLayer => l.type === "tilelayer")
    .map((layer) => makeTilemap(layer, tilesetsData, tileheight, tilewidth));

  const objects = map.layers
    .filter((l): l is ObjectGroup => l.type === "objectgroup")
    .reduce(makeObjects, {});

  return { tilemaps, objects };
};

export class TilemapComponent<
  Parent extends GameObject = GameObject
> extends Component<Parent> {
  static objectToRapierColliderDesc = objectToRapierColliderDesc;
  static objectsToRapierCollidersDescs = objectsToRapierCollidersDesc;

  static parseMapAsset = parseMapAsset;

  static createTilemapComponents = (
    parent: GameObject,
    tilemaps: CompositeTilemap[]
  ) => {
    return tilemaps.map((tilemap) =>
      parent.addComponent(TilemapComponent, tilemap)
    );
  };

  name = "TilemapComponent";
  // data: { tilemap: CompositeTilemap; bodies: Body[] }[]

  tilemap: CompositeTilemap;

  constructor(parent: Parent, tilemap: CompositeTilemap) {
    super(parent);

    this.tilemap = tilemap;
  }

  onAdded(): void {
    super.onAdded();

    this.parent.scene.display.addChild(this.tilemap);
  }

  onRemoved(): void {
    super.onRemoved();

    this.parent.scene.display.removeChild(this.tilemap);
  }
}
