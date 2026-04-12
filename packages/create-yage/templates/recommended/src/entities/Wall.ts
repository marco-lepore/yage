import { Entity, Transform, Vec2 } from "@yage/core";
import { ColliderComponent, RigidBodyComponent } from "@yage/physics";
import { LAYER_PLATFORM, LAYER_PLAYER } from "../layers.js";

/** Invisible static boundary used to fence the player into the playable area. */
export class Wall extends Entity {
  setup(params: { x: number; y: number; width: number; height: number }): void {
    const { x, y, width, height } = params;

    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({
        shape: { type: "box", width, height },
        friction: 0,
        layers: LAYER_PLATFORM,
        mask: LAYER_PLAYER,
      }),
    );
  }
}
