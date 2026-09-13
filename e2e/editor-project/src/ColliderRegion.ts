import { Entity, Transform } from "@yagejs/core";
import {
  defineLevelEntity,
  defineParams,
  param,
  type ParamsOf,
} from "@yagejs/level";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";

const RegionParams = defineParams({
  width: param.number(160, { min: 1 }),
  height: param.number(40, { min: 1 }),
  sensor: param.boolean(false),
});

/** An invisible collider whose origin is its upper-left corner. */
export class ColliderRegion extends Entity {
  static readonly level = defineLevelEntity({
    id: "game.collider-region",
    version: 1,
    params: RegionParams,
  });

  setup(params: ParamsOf<typeof RegionParams>): void {
    this.add(new Transform());
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: params.width, height: params.height },
        offset: { x: params.width / 2, y: params.height / 2 },
        sensor: params.sensor,
      }),
    );
  }
}
