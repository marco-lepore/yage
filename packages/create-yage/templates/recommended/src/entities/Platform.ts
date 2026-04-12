import { Entity, Transform, Vec2 } from "@yage/core";
import { GraphicsComponent } from "@yage/renderer";
import { ColliderComponent, RigidBodyComponent } from "@yage/physics";
import { LAYER_PLATFORM, LAYER_PLAYER } from "../layers.js";

/** Static platform with a visible surface and top-edge highlight. */
export class Platform extends Entity {
  setup(params: { x: number; y: number; width: number; height: number }): void {
    const { x, y, width, height } = params;

    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.rect(-width / 2, -height / 2, width, height).fill({
          color: 0x475569,
        });
        g.rect(-width / 2, -height / 2, width, 3).fill({ color: 0x64748b });
      }),
    );
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
