import { ColliderDesc } from "@dimforge/rapier2d";
import { getPixelToPhysicsUnitConverter } from "../../utils";
import { RectangleObject, PolygonObject, TileObject } from "./types";

export const objectToRapierColliderDesc = (
  obj: RectangleObject | PolygonObject,
  postActions: (colliderDesc: ColliderDesc, object: TileObject) => void
) => {
  const px2pu = getPixelToPhysicsUnitConverter();
  const [objX, objY, objW, objH] = px2pu(obj.x, obj.y, obj.width, obj.height);

  if (obj.polygon) {
    const vertices = px2pu(...obj.polygon.flatMap(({ x, y }) => [x, y]));

    const colliderDesc = ColliderDesc.convexHull(
      new Float32Array(vertices)
    )?.setTranslation(objX, objY);
    if (!colliderDesc) {
      throw new Error(`couldn't create collider for object ${obj.id}`);
    }
    postActions(colliderDesc, obj);

    return colliderDesc;
  }

  const colliderDesc = ColliderDesc.cuboid(objW / 2, objH / 2).setTranslation(
    objX + objW / 2,
    objY + objH / 2
  );

  postActions(colliderDesc, obj);

  return colliderDesc;
};

export const objectsToRapierCollidersDesc = (
  objects: TileObject[],
  postActions: (colliderDesc: ColliderDesc, object: TileObject) => void
) => {
  return objects
    .filter(
      (obj): obj is PolygonObject | RectangleObject =>
        !!obj.polygon || !obj.point
    )
    .map((obj) => objectToRapierColliderDesc(obj, postActions));
};
