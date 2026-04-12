import { Scene, Transform, Vec2 } from "@yage/core";
import { CameraKey, GraphicsComponent } from "@yage/renderer";

/**
 * Empty starter scene. Edit this file to start building your game.
 *
 * Some things to try:
 *   - Draw a sprite: `new SpriteComponent(texture("/assets/hero.png"))`
 *   - Add physics:   `npm install @yage/physics` + `new PhysicsPlugin(...)`
 *   - Handle input:  `npm install @yage/input` + `new InputPlugin(...)`
 */
export class MainScene extends Scene {
  readonly name = "main";

  onEnter(): void {
    const camera = this.context.resolve(CameraKey);
    camera.position = new Vec2(400, 300);

    const placeholder = this.spawn("placeholder");
    placeholder.add(new Transform({ position: new Vec2(400, 300) }));
    placeholder.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-160, -40, 320, 80).fill({ color: 0x1e293b });
        g.rect(-160, -40, 320, 80).stroke({ color: 0x38bdf8, width: 2 });
      }),
    );
  }
}
