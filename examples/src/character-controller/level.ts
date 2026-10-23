import { Entity, Transform, Vec2 } from "@yagejs/core";
import {
  GraphicsComponent,
  TextComponent,
  type ColorValue,
} from "@yagejs/renderer";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import { MovingSurface } from "@yagejs-addons/character-controller";
import { COLORS, FLOOR_Y } from "./constants.js";

interface SlabParams {
  x: number;
  y: number;
  width: number;
  height?: number;
}

/** A filled box with a lighter top edge, centred on the entity. */
function slab(
  width: number,
  height: number,
  fill: ColorValue,
  edge: ColorValue,
): GraphicsComponent {
  return new GraphicsComponent().draw((g) => {
    g.rect(-width / 2, -height / 2, width, height).fill({ color: fill });
    g.rect(-width / 2, -height / 2, width, 3).fill({ color: edge });
  });
}

/** Solid terrain: ground, walls, and blocks. */
export class PlatformEntity extends Entity {
  setup({ x, y, width, height = 16 }: SlabParams): void {
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({
        shape: { type: "box", width, height },
        friction: 0,
      }),
    );
    this.add(slab(width, height, COLORS.solid, COLORS.edge));
  }
}

/** A platform the player jumps up through and lands on. Down plus jump drops through it. */
export class OneWayPlatformEntity extends Entity {
  setup({ x, y, width, height = 16 }: SlabParams): void {
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({
        shape: { type: "box", width, height },
        friction: 0,
        oneWay: {},
      }),
    );
    this.add(slab(width, height, COLORS.oneWay, COLORS.oneWay));
  }
}

/**
 * A one-way platform that travels back and forth between two points and
 * carries the player standing on it. Spawn it before the player, so its
 * velocity for the step is known before the player reads it.
 */
export class MovingPlatformEntity extends Entity {
  setup({
    x,
    y,
    width,
    height = 16,
    to,
  }: SlabParams & { to: { x: number; y: number } }): void {
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(new RigidBodyComponent({ type: "kinematic" }));
    this.add(
      new ColliderComponent({
        shape: { type: "box", width, height },
        friction: 0,
        oneWay: {},
      }),
    );
    this.add(slab(width, height, COLORS.moving, COLORS.moving));
    this.add(new MovingSurface({ from: { x, y }, to, speed: 65 }));
  }
}

/** A solid ramp from `left` px above the floor to `right` px above it. */
export class RampEntity extends Entity {
  setup({
    x,
    width,
    left,
    right,
  }: {
    x: number;
    width: number;
    left: number;
    right: number;
  }): void {
    this.add(new Transform({ position: new Vec2(x, FLOOR_Y) }));
    const vertices = [
      { x: 0, y: -left },
      { x: width, y: -right },
      { x: width, y: 20 },
      { x: 0, y: 20 },
    ];
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({
        shape: { type: "polygon", vertices },
        friction: 0,
      }),
    );
    this.add(
      new GraphicsComponent().draw((g) => {
        g.poly(vertices.flatMap(({ x, y }) => [x, y])).fill({
          color: COLORS.solid,
        });
        g.moveTo(0, -left)
          .lineTo(width, -right)
          .stroke({ color: COLORS.edge, width: 3 });
      }),
    );
  }
}

/** A centred instruction in the world. */
export class SignEntity extends Entity {
  setup({
    x,
    y,
    text,
    color = COLORS.sign,
  }: {
    x: number;
    y: number;
    text: string;
    color?: ColorValue;
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
