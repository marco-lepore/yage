import { Entity, Transform, Vec2, trait } from "@yage/core";
import { GraphicsComponent } from "@yage/renderer";
import { ColliderComponent, RigidBodyComponent } from "@yage/physics";
import { Oscillate } from "../components/Oscillate.js";
import { LAYER_HAZARD, LAYER_PLAYER } from "../layers.js";
import { Hostile } from "../traits.js";

/** Sliding hazard. Marked `@trait(Hostile)` so the Player detects it on collision. */
@trait(Hostile)
export class Hazard extends Entity {
  setup(params: {
    x: number;
    y: number;
    amplitude: number;
    period: number;
  }): void {
    const { x, y, amplitude, period } = params;

    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          const x1 = Math.cos(angle) * 14;
          const y1 = Math.sin(angle) * 14;
          const xA = Math.cos(angle - Math.PI / 8) * 8;
          const yA = Math.sin(angle - Math.PI / 8) * 8;
          const xB = Math.cos(angle + Math.PI / 8) * 8;
          const yB = Math.sin(angle + Math.PI / 8) * 8;
          g.poly([xA, yA, x1, y1, xB, yB]).fill({ color: 0xef4444 });
        }
        g.circle(0, 0, 9).fill({ color: 0xb91c1c });
        g.circle(0, 0, 9).stroke({ color: 0x7f1d1d, width: 2 });
      }),
    );
    this.add(
      new RigidBodyComponent({ type: "kinematic", fixedRotation: true }),
    );
    this.add(
      new ColliderComponent({
        shape: { type: "circle", radius: 12 },
        sensor: true,
        layers: LAYER_HAZARD,
        mask: LAYER_PLAYER,
      }),
    );
    this.add(new Oscillate({ axis: "x", amplitude, period }));
  }
}
