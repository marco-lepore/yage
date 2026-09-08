import { Component, Entity, Scene, Transform, Vec2 } from "@yagejs/core";
import {
  CameraEntity,
  GraphicsComponent,
  TextComponent,
} from "@yagejs/renderer";
import { InputManagerKey } from "@yagejs/input";

class ScoutMotion extends Component {
  elapsed = 0;
  presses = 0;
  update(dt: number): void {
    this.elapsed += dt;
    if (this.service(InputManagerKey).isJustPressed("signal")) this.presses++;
    this.entity
      .get(Transform)
      ?.setPosition(290 + Math.sin(this.elapsed) * 32, 225);
  }
}
class Scout extends Entity {
  setup(params: {
    x: number;
    y: number;
    color: number;
    moving?: boolean;
  }): void {
    this.add(new Transform({ position: new Vec2(params.x, params.y) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.ellipse(0, 15, 17, 7).fill({ color: 0x071021, alpha: 0.65 });
        g.roundRect(-12, -7, 24, 29, 6).fill(params.color);
        g.circle(0, -13, 10).fill(0xf7d5b1);
        g.roundRect(-12, -25, 24, 9, 3).fill(0x253754);
      }),
    );
    if (params.moving) this.add(new ScoutMotion());
  }
}
export class FormationScene extends Scene {
  readonly name = "formation-study";
  onEnter(): void {
    const ground = this.spawn("camp-ground");
    ground.add(new Transform());
    ground.add(
      new GraphicsComponent().draw((g) => {
        g.rect(0, 0, 800, 450).fill(0x172b38);
        for (let x = 0; x < 800; x += 40)
          g.moveTo(x, 0).lineTo(x, 450).stroke({ color: 0x24404b, width: 1 });
        for (let y = 0; y < 450; y += 40)
          g.moveTo(0, y).lineTo(800, y).stroke({ color: 0x24404b, width: 1 });
        g.roundRect(100, 120, 460, 195, 55).fill({
          color: 0x9b8461,
          alpha: 0.2,
        });
        g.poly([110, 205, 168, 115, 230, 205]).fill(0xcdbd8f);
        g.poly([168, 155, 145, 205, 190, 205]).fill(0x3c4650);
        g.circle(490, 260, 17).fill(0x784b39);
        g.poly([480, 266, 490, 239, 501, 265]).fill(0xf9b56d);
      }),
    );
    this.spawn(
      Scout,
      { x: 290, y: 225, color: 0xefb365, moving: true },
      { key: "scout-amber" },
    );
    this.spawn(
      Scout,
      { x: 335, y: 250, color: 0x80b9df },
      { key: "scout-blue" },
    );
    this.spawn(
      Scout,
      { x: 375, y: 218, color: 0x7fc6a4 },
      { key: "scout-green" },
    );
    this.spawn(
      Scout,
      { x: 1500, y: 1000, color: 0xff0000 },
      { key: "offscreen-scout" },
    );
    const title = this.spawn("camp-label");
    title.add(new Transform({ position: new Vec2(38, 30) }));
    title.add(
      new TextComponent({
        text: "NORTH CAMP / SCOUT PATROL",
        style: { fontFamily: "monospace", fontSize: 16, fill: 0xa8c9db },
      }),
    );
    this.spawn(CameraEntity, {
      position: new Vec2(400, 225),
      zoom: 1,
    });
  }
}
