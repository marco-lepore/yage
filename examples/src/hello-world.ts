import { Component, Transform, Vec2 } from "@yage/core";
import { GraphicsComponent } from "@yage/renderer";
import { createGame, defineInlineScene } from "yage";
import { injectStyles } from "./shared.js";

injectStyles();

// ---------------------------------------------------------------------------
// Spin — rotates an entity at a constant rate
// ---------------------------------------------------------------------------
class Spin extends Component {
  private readonly transform = this.sibling(Transform);
  private speed: number;
  constructor(speed = 0.002) {
    super();
    this.speed = speed;
  }
  update(dt: number): void {
    this.transform.rotate(this.speed * dt);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
await createGame({
  backgroundColor: 0x0a0a0a,
  debug: true,
  scene: defineInlineScene("hello-world", (scene, { camera }) => {
    camera.position = new Vec2(400, 300);

    // Blue circle
    const circle = scene.spawn("circle");
    circle.add(new Transform({ position: new Vec2(250, 300) }));
    circle.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 50).fill({ color: 0x38bdf8 });
        g.circle(0, 0, 50).stroke({ color: 0x0ea5e9, width: 2 });
      }),
    );

    // Orange rectangle
    const rect = scene.spawn("rect");
    rect.add(new Transform({ position: new Vec2(550, 300) }));
    rect.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-60, -40, 120, 80).fill({ color: 0xf97316 });
        g.rect(-60, -40, 120, 80).stroke({ color: 0xea580c, width: 2 });
      }),
    );

    // Green rotating triangle
    const tri = scene.spawn("triangle");
    tri.add(new Transform({ position: new Vec2(400, 200) }));
    tri.add(
      new GraphicsComponent().draw((g) => {
        g.poly([0, -45, 40, 35, -40, 35]).fill({ color: 0x22c55e });
        g.poly([0, -45, 40, 35, -40, 35]).stroke({ color: 0x16a34a, width: 2 });
      }),
    );
    tri.add(new Spin(0.002));

    // Small purple rotating diamond
    const diamond = scene.spawn("diamond");
    diamond.add(new Transform({ position: new Vec2(400, 430) }));
    diamond.add(
      new GraphicsComponent().draw((g) => {
        g.poly([0, -30, 25, 0, 0, 30, -25, 0]).fill({ color: 0xa78bfa });
        g.poly([0, -30, 25, 0, 0, 30, -25, 0]).stroke({
          color: 0x7c3aed,
          width: 2,
        });
      }),
    );
    diamond.add(new Spin(-0.003));
  }),
});
