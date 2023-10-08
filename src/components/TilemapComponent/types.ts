import { CompositeTilemap } from '@pixi/tilemap'
export interface PhysicsData {
  [key: string]: PhysicsObject
}

export interface PhysicsObject {
  type: Type
  label: string
  isStatic: boolean
  density: number
  restitution: number
  friction: number
  frictionAir: number
  frictionStatic: number
  collisionFilter: CollisionFilter
  fixtures: Fixture[]
}

export interface CollisionFilter {
  group: number
  category: number
  mask: number
}

export interface Fixture {
  label: string
  isSensor: boolean
  vertices: Array<Vertex[]>
}

export interface Vertex {
  x: number
  y: number
}

export enum Type {
  FromPhysicsEditor = 'fromPhysicsEditor',
}

export interface Grid {
  height: number
  orientation: string
  width: number
}

export interface Property {
  name: string
  type: string
  value: string
}

export interface Tile {
  id: number
  image: string
  imageheight: number
  imagewidth: number
}

export interface TilesetData {
  columns: number
  grid: Grid
  margin: number
  name: string
  properties: Property[]
  spacing: number
  tilecount: number
  tiledversion: string
  tileheight: number
  tiles: Tile[]
  tilewidth: number
  type: string
  version: string
}
export interface MapData {
  compressionlevel: number
  height: number
  infinite: boolean
  layers: (TileLayer | ObjectGroup)[]
  nextlayerid: number
  nextobjectid: number
  orientation: string
  renderorder: string
  tiledversion: string
  tileheight: number
  tilesets: Tileset[]
  tilewidth: number
  type: string
  version: string
  width: number
}

export interface ObjectGroup {
  draworder: string
  id: number
  name: string
  objects: TileObject[]
  opacity: number
  type: 'objectgroup'
  visible: boolean
  x: number
  y: number
}

export interface TileLayer {
  data: number[]
  height: number
  id: number
  name: string
  opacity: number
  type: 'tilelayer'
  visible: boolean
  width: number
  x: number
  y: number
}

export interface RectangleObject {
  class: string
  type: string
  height: number
  id: number
  name: string
  rotation: number
  visible: boolean
  width: number
  x: number
  y: number
  polygon: undefined
  point: undefined | false
}

export interface PolygonObject {
  class: string
  type: string
  height: number
  id: number
  name: string
  rotation: number
  visible: boolean
  width: number
  x: number
  y: number
  polygon: Polygon[]
  point: undefined | false
}

export interface PointObject {
  class: string
  type: string
  height: number
  id: number
  name: string
  rotation: number
  visible: boolean
  width: number
  x: number
  y: number
  point: true
  polygon: undefined
}

export type TileObject = RectangleObject | PointObject | PolygonObject

export interface Polygon {
  x: number
  y: number
}

export interface Tileset {
  firstgid: number
  source: string
}
export type TileTexture = Parameters<CompositeTilemap['tile']>[0]
