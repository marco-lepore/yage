import { Entity, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import { MovingSurface } from "@yagejs-addons/character-controller/platformer";
import { COLORS, ONE_WAY, PLAYER, SOLID } from "./constants.js";

export class Platform extends Entity {
  setup({
    x,
    y,
    width,
    height = 16,
    oneWay = false,
    to,
  }: {
    x: number;
    y: number;
    width: number;
    height?: number;
    oneWay?: boolean;
    to?: { x: number; y: number };
  }): void {
    const color = to ? COLORS.moving : oneWay ? COLORS.oneWay : COLORS.solid;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(new RigidBodyComponent({ type: to ? "kinematic" : "static" }));
    this.add(
      new ColliderComponent({
        shape: { type: "box", width, height },
        layers: oneWay ? ONE_WAY : SOLID,
        mask: PLAYER,
        friction: 0,
        ...(oneWay ? { oneWay: {} } : {}),
      }),
    );
    this.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-width / 2, -height / 2, width, height).fill({ color });
        g.rect(-width / 2, -height / 2, width, 3).fill({
          color: oneWay || to ? color : COLORS.edge,
        });
      }),
    );
    if (to) this.add(new MovingSurface({ from: { x, y }, to, speed: 65 }));
  }
}

export class Ramp extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(390, 540) }));
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({
        shape: {
          type: "polygon",
          vertices: [
            { x: 0, y: 0 },
            { x: 130, y: -60 },
            { x: 130, y: 0 },
          ],
        },
        layers: SOLID,
        mask: PLAYER,
        friction: 0,
      }),
    );
    this.add(
      new GraphicsComponent().draw((g) => {
        g.poly([0, 0, 130, -60, 130, 0]).fill({ color: COLORS.solid });
        g.moveTo(0, 0)
          .lineTo(130, -60)
          .stroke({ color: COLORS.edge, width: 3 });
      }),
    );
  }
}

export class Sign extends Entity {
  setup({
    x,
    y,
    text,
    color = 0x94a3b8,
  }: {
    x: number;
    y: number;
    text: string;
    color?: number;
  }): void {
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new TextComponent({
        text,
        anchor: { x: 0.5, y: 0 },
        style: {
          fontFamily: "monospace",
          fontSize: 13,
          fill: color,
          align: "center",
        },
      }),
    );
  }
}
