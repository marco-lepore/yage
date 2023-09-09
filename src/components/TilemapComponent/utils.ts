import { ColliderDesc } from '@dimforge/rapier2d'
import { getPixelToPhysicsUnitConverter } from '../../utils'
import { RectangleObject, PolygonObject, TileObject } from './types'

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
