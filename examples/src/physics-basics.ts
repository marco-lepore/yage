import { Scene, Component, Transform, Vec2 } from "@yage/core";
import { GraphicsComponent, CameraKey } from "@yage/renderer";
import {
  PhysicsWorldManagerKey,
  RigidBodyComponent,
  ColliderComponent,
} from "@yage/physics";
import type { PhysicsWorld } from "@yage/physics";
import { InputManagerKey } from "@yage/input";
import { createGame } from "yage";
import { injectStyles } from "./shared.js";

injectStyles();

const WIDTH = 800;
const HEIGHT = 600;
const WALL = 20;

// ---------------------------------------------------------------------------
// InputController — handles spawning shapes, impulse, gravity flip
// ---------------------------------------------------------------------------
class InputController extends Component {
  private readonly input = this.service(InputManagerKey);
  private world!: PhysicsWorld;
  private gravityDown = true;
  private shapeCount = 0;

  onAdd(): void {
    this.world = this.use(PhysicsWorldManagerKey).getOrCreateWorld(this.scene);
  }

  update(): void {
    const scene = this.scene;

    // Space — drop a random shape
    if (this.input.isJustPressed("spawn")) {
      this.shapeCount++;
      const isCircle = Math.random() > 0.5;
      const x = 100 + Math.random() * (WIDTH - 200);
      const restitution = 0.1 + Math.random() * 0.8;
      const color = randomColor();
      const bouncy = restitution > 0.5;

      const e = scene.spawn(`shape-${this.shapeCount}`);
      e.add(new Transform({ position: new Vec2(x, 40) }));

      if (isCircle) {
        const radius = 12 + Math.random() * 18;
        e.add(
          new GraphicsComponent().draw((g) => {
            g.circle(0, 0, radius).fill({ color, alpha: 0.85 });
            g.circle(0, 0, radius).stroke({
              color: bouncy ? 0xffffff : 0x666666,
              width: bouncy ? 2 : 1,
            });
          }),
        );
        e.add(new RigidBodyComponent({ type: "dynamic", ccd: true }));
        e.add(
          new ColliderComponent({
            shape: { type: "circle", radius },
            restitution,
            friction: 0.3,
            density: 1,
          }),
        );
      } else {
        const hw = 10 + Math.random() * 20;
        const hh = 10 + Math.random() * 20;
        e.add(
          new GraphicsComponent().draw((g) => {
            g.rect(-hw, -hh, hw * 2, hh * 2).fill({ color, alpha: 0.85 });
            g.rect(-hw, -hh, hw * 2, hh * 2).stroke({
              color: bouncy ? 0xffffff : 0x666666,
              width: bouncy ? 2 : 1,
            });
          }),
        );
        e.add(new RigidBodyComponent({ type: "dynamic", ccd: true }));
        e.add(
          new ColliderComponent({
            shape: { type: "box", width: hw * 2, height: hh * 2 },
            restitution,
            friction: 0.3,
            density: 1,
          }),
        );
      }
    }

    // F — apply upward impulse to all dynamic bodies
    if (this.input.isJustPressed("impulse")) {
      for (const entity of scene.getEntities()) {
        if (entity.isDestroyed) continue;
        const rb = entity.tryGet(RigidBodyComponent);
        if (rb && rb.type === "dynamic") {
          rb.applyImpulse(new Vec2(0, -4000));
        }
      }
    }

    // G — flip gravity
    if (this.input.isJustPressed("gravity")) {
      this.gravityDown = !this.gravityDown;
      this.world.setGravity(0, this.gravityDown ? 980 : -980);
    }
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class PhysicsBasicsScene extends Scene {
  readonly name = "physics-basics";
  private readonly camera = this.service(CameraKey);

  onEnter(): void {
    this.camera.position = new Vec2(WIDTH / 2, HEIGHT / 2);

    // Controller entity
    const ctrl = this.spawn("controller");
    ctrl.add(new Transform());
    ctrl.add(new InputController());

    // Floor
    this.createWall(WIDTH / 2, HEIGHT - WALL / 2, WIDTH, WALL, 0x444444);
    // Ceiling
    this.createWall(WIDTH / 2, WALL / 2, WIDTH, WALL, 0x333333);
    // Left wall
    this.createWall(WALL / 2, HEIGHT / 2, WALL, HEIGHT, 0x333333);
    // Right wall
    this.createWall(WIDTH - WALL / 2, HEIGHT / 2, WALL, HEIGHT, 0x333333);
  }

  private createWall(
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
  ): void {
    const e = this.spawn("wall");
    e.add(new Transform({ position: new Vec2(x, y) }));
    e.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color });
      }),
    );
    e.add(new RigidBodyComponent({ type: "static" }));
    e.add(
      new ColliderComponent({
        shape: { type: "box", width: w, height: h },
        restitution: 0.3,
        friction: 0.5,
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const PALETTE = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0xa78bfa, 0xf97316, 0x38bdf8, 0xfb7185, 0x34d399];
function randomColor(): number {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)]!;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
await createGame({
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: 0x0a0a0a,
  physics: true,
  debug: true,
  input: {
    actions: {
      spawn: ["Space"],
      impulse: ["KeyF"],
      gravity: ["KeyG"],
    },
    preventDefaultKeys: ["Space"],
  },
  scene: new PhysicsBasicsScene(),
});
