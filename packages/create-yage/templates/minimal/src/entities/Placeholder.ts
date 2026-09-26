import { Entity, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";

/**
 * A placeholder rectangle. Replace it with your first game object.
 *
 * Every kind of entity is an `Entity` subclass like this one: `setup(params)`
 * adds its components, and the scene spawns it with
 * `this.spawn(Placeholder, { x, y })`. Give it behaviour by adding a component
 * whose `update(dt)` holds the rule.
 */
export class Placeholder extends Entity {
  setup(params: { x: number; y: number }): void {
    this.add(new Transform({ position: new Vec2(params.x, params.y) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-160, -40, 320, 80).fill({ color: 0x1e293b });
        g.rect(-160, -40, 320, 80).stroke({ color: 0x38bdf8, width: 2 });
      }),
    );
  }
}
