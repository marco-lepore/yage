import { ColliderDesc } from '@dimforge/rapier2d'
import { getPixelToPhysicsUnitConverter } from '../space'
import { CompositeTilemap } from '@pixi/tilemap'
import { Assets, Texture } from 'pixi.js'
import {
  RectangleObject,
  PolygonObject,
  TileObject,
  TileLayer,
  TilesetData,
  ObjectGroup,
  MapData,
  PointObject,
} from './types'

export const scaleValue = (scale: number) => (v: number) => v * scale

const scaleObject = (object: TileObject, scale = 1) => {
  const scaleFunction = scaleValue(scale)
  if (object.point) {
    const scaledObject: PointObject = {
      ...object,
      height: scaleFunction(object.height),
      width: scaleFunction(object.width),
      x: scaleFunction(object.x),
      y: scaleFunction(object.y),
    }
    return scaledObject
  }
  if (!object.point && object.polygon) {
    const scaledObject: PolygonObject = {
      ...(object as PolygonObject),
      height: scaleFunction(object.height),
      width: scaleFunction(object.width),
      x: scaleFunction(object.x),
      y: scaleFunction(object.y),
      polygon: object.polygon.map((p) => ({
        x: scaleFunction(p.x),
        y: scaleFunction(p.y),
      })),
    }
    return scaledObject
  }
  const scaledObject: RectangleObject = {
    ...(object as RectangleObject),
    height: scaleFunction(object.height),
    width: scaleFunction(object.width),
    x: scaleFunction(object.x),
    y: scaleFunction(object.y),
  }
  return scaledObject
}

export const objectToRapierColliderDesc = (
  object: RectangleObject | PolygonObject,
  postActions: (colliderDesc: ColliderDesc, object: TileObject) => void,
) => {
  const px2pu = getPixelToPhysicsUnitConverter()
  const [objectX, objectY, objectW, objectH] = px2pu(
    object.x,
    object.y,
    object.width,
    object.height,
  )

  if (object.polygon) {
    const vertices = px2pu(...object.polygon.flatMap(({ x, y }) => [x, y]))

    const colliderDesc = ColliderDesc.convexHull(
      new Float32Array(vertices),
    )?.setTranslation(objectX, objectY)
    if (!colliderDesc) {
      throw new Error(`couldn't create collider for object ${object.id}`)
    }
    postActions(colliderDesc, object)

    return colliderDesc
  }

  const colliderDesc = ColliderDesc.cuboid(
    objectW / 2,
    objectH / 2,
  ).setTranslation(objectX + objectW / 2, objectY + objectH / 2)

  postActions(colliderDesc, object)

  return colliderDesc
}

export const objectsToRapierCollidersDesc = (
  objects: TileObject[],
  postActions: (colliderDesc: ColliderDesc, object: TileObject) => void,
) => {
  return objects
    .filter(
      (object): object is PolygonObject | RectangleObject =>
        !!object.polygon || !object.point,
    )
    .map((object) => objectToRapierColliderDesc(object, postActions))
}

const makeTilemap = (
  layer: TileLayer,
  tilesetsData: {
    data: TilesetData
    firstgid: number
    source: string
  }[],
  tileheight: number,
  tilewidth: number,
  scale = 1,
) => {
  const tilemap = new CompositeTilemap()
  const { data, width } = layer
  data.forEach((tile, index) => {
    if (tile === 0) {
      return
    }

    const tileset = tilesetsData
      .sort(({ firstgid: a }, { firstgid: b }) => (a > b ? 1 : -1))
      .find(({ firstgid }, index) => {
        const nextTileset = tilesetsData[index + 1]
        return nextTileset
          ? firstgid <= tile && nextTileset.firstgid > tile
          : firstgid <= tile
      })

    if (!tileset) {
      throw new Error('invalid tileset for tile gid ' + tile)
    }

    const tileData = tileset.data.tiles[tile - tileset.firstgid]
    const x = index % width
    const y = Math.floor(index / width)
    const textureNameMatch = tileData?.image.match(/[^/]*$/)
    const textureName = textureNameMatch && textureNameMatch[0]
    if (!textureName) {
      throw new Error('invalid texturename ' + textureName)
    }

    const texture = Assets.get(textureName) as Texture
    if (!texture) {
      throw new Error('invalid texture ' + texture)
    }

    tilemap.tile(textureName, x * tilewidth, y * tileheight)
  })

  tilemap.scale.set(scale)

  return tilemap
}

const makeObjects = (
  objects: Record<string, TileObject[]>,
  objectGroup: ObjectGroup,
  scale = 1,
) => {
  objectGroup.objects.forEach((object) => {
    const c = object.class ?? object.type ?? object.name
    if (!objects[c]) {
      objects[c] = []
    }
    if (scale === 1) {
      objects[c].push(object)
    } else {
      const scaledObject = scaleObject(object, scale)
      objects[c].push(scaledObject)
    }
  })

  return objects
}
export const parseMapAsset = (mapName: string, scale = 1) => {
  const map = Assets.get(mapName) as MapData
  if (!map.layers) {
    throw new Error(`${mapName} does not contain tiled map data`)
  }

  const { tilesets } = map

  const tilesetsData = tilesets.map((tileset) => {
    const tilesetData = Assets.get(tileset.source) as TilesetData
    return {
      ...tileset,
      data: tilesetData,
    }
  })

  const { tileheight, tilewidth, layers } = map

  const tilemaps = layers
    .filter((l): l is TileLayer => l.type === 'tilelayer')
    .map((layer) =>
      makeTilemap(layer, tilesetsData, tileheight, tilewidth, scale),
    )

  const objects = layers
    .filter((l): l is ObjectGroup => l.type === 'objectgroup')
    .reduce((previous, current) => makeObjects(previous, current, scale), {})

  return { tilemaps, objects }
}

export * from './types'
