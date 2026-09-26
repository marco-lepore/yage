/**
 * Physics basics — dynamic bodies falling into a walled box.
 *
 * Space drops a shape with a random collider type (circle, box, rounded box
 * or triangle), size, colour and bounciness. F pushes every dynamic body
 * upwards with an impulse, and G flips gravity.
 */
import {
  Component,
  Engine,
  Entity,
  RandomKey,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import { RendererPlugin, GraphicsComponent } from "@yagejs/renderer";
import {
  PhysicsPlugin,
  PhysicsWorldKey,
  RigidBodyComponent,
  ColliderComponent,
} from "@yagejs/physics";
import type { ColliderShape } from "@yagejs/physics";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WIDTH = 800;
const HEIGHT = 600;
const WALL = 20;
/** Height, in pixels, a dropped shape starts at. */
const DROP_Y = 40;
/** Gravity strength in px/s². G flips its sign. */
const GRAVITY = 980;
/** Upward impulse F applies to every dynamic body. */
const LAUNCH_IMPULSE = new Vec2(0, -4000);
const FILL_ALPHA = 0.85;
const PALETTE = [
  0xff6b6b, 0x4ecdc4, 0xffe66d, 0xa78bfa, 0xf97316, 0x38bdf8, 0xfb7185,
  0x34d399,
];

/** Shapes Space picks from at random, one per collider type. */
const SHAPE_KINDS = ["circle", "box", "roundedBox", "triangle"] as const;

// ---------------------------------------------------------------------------
// Dropped shapes — one Entity subclass per collider type
// ---------------------------------------------------------------------------

/** What every dropped shape takes, whatever its collider type. */
interface DropParams {
  /** Horizontal drop position in pixels. */
  x: number;
  color: number;
  /** Bounciness, 0 to 1. Above 0.5 the shape counts as bouncy. */
  restitution: number;
}

/** Bouncy shapes get a thick white outline, the rest a thin grey one. */
function outline(restitution: number): { color: number; width: number } {
  return restitution > 0.5
    ? { color: 0xffffff, width: 2 }
    : { color: 0x666666, width: 1 };
}

/** The transform, body and collider every dropped shape shares. */
function addDynamicBody(
  entity: Entity,
  params: DropParams,
  shape: ColliderShape,
): void {
  entity.add(new Transform({ position: new Vec2(params.x, DROP_Y) }));
  entity.add(new RigidBodyComponent({ type: "dynamic", ccd: true }));
  entity.add(
    new ColliderComponent({
      shape,
      restitution: params.restitution,
      friction: 0.3,
      density: 1,
    }),
  );
}

class CircleShape extends Entity {
  setup(params: DropParams & { radius: number }): void {
    const { color, radius } = params;
    addDynamicBody(this, params, { type: "circle", radius });
    this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, radius).fill({ color, alpha: FILL_ALPHA });
        g.circle(0, 0, radius).stroke(outline(params.restitution));
      }),
    );
  }
}

class BoxShape extends Entity {
  setup(params: DropParams & { width: number; height: number }): void {
    const { color, width, height } = params;
    addDynamicBody(this, params, { type: "box", width, height });
    this.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-width / 2, -height / 2, width, height).fill({
          color,
          alpha: FILL_ALPHA,
        });
        g.rect(-width / 2, -height / 2, width, height).stroke(
          outline(params.restitution),
        );
      }),
    );
  }
}

/**
 * A box collider with rounded corners. The radius shrinks the inner
 * half-extents, so the outer footprint still measures `width` by `height`
 * and the shape rests at the same height as a plain box. Rounded corners
 * also stop a body catching on the junction between two segments of a
 * polyline terrain chain.
 */
class RoundedBoxShape extends Entity {
  setup(params: DropParams & { width: number; height: number }): void {
    const { color, width, height } = params;
    // Has to stay under half the shorter side, or the collider throws.
    const radius = Math.min(width, height) * 0.25;
    addDynamicBody(this, params, {
      type: "box",
      width,
      height,
      borderRadius: radius,
    });
    this.add(
      new GraphicsComponent().draw((g) => {
        g.roundRect(-width / 2, -height / 2, width, height, radius).fill({
          color,
          alpha: FILL_ALPHA,
        });
        g.roundRect(-width / 2, -height / 2, width, height, radius).stroke(
          outline(params.restitution),
        );
      }),
    );
  }
}

/**
 * A near-equilateral triangle on a convex polygon collider. The debug
 * overlay (open the page with `?debug=overlay`) draws its wireframe.
 */
class TriangleShape extends Entity {
  setup(params: DropParams & { size: number }): void {
    const { color, size } = params;
    const vertices = [
      new Vec2(0, -size),
      new Vec2(size * 0.87, size * 0.5),
      new Vec2(-size * 0.87, size * 0.5),
    ];
    addDynamicBody(this, params, { type: "polygon", vertices });
    this.add(
      new GraphicsComponent().draw((g) => {
        g.poly(vertices)
          .fill({ color, alpha: FILL_ALPHA })
          .stroke(outline(params.restitution));
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------
class WallEntity extends Entity {
  setup(params: {
    x: number;
    y: number;
    w: number;
    h: number;
    color: number;
  }): void {
    const { x, y, w, h, color } = params;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color });
      }),
    );
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: w, height: h },
        restitution: 0.3,
        friction: 0.5,
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// PhysicsControls — Space drops a shape, F launches, G flips gravity
// ---------------------------------------------------------------------------
class PhysicsControls extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly random = this.service(RandomKey);
  private readonly world = this.service(PhysicsWorldKey);
  private gravityDown = true;

  update(): void {
    if (this.input.isJustPressed("spawn")) this.dropShape();
    if (this.input.isJustPressed("impulse")) this.launchAll();
    if (this.input.isJustPressed("gravity")) this.flipGravity();
  }

  /** Drops a shape of a random collider type, size, colour and bounciness. */
  private dropShape(): void {
    const random = this.random;
    const drop: DropParams = {
      x: random.range(100, WIDTH - 100),
      color: random.pick(PALETTE),
      restitution: random.range(0.1, 0.9),
    };
    switch (random.pick(SHAPE_KINDS)) {
      case "circle":
        this.scene.spawn(CircleShape, {
          ...drop,
          radius: random.range(12, 30),
        });
        break;
      case "box":
        this.scene.spawn(BoxShape, {
          ...drop,
          width: random.range(20, 60),
          height: random.range(20, 60),
        });
        break;
      case "roundedBox":
        this.scene.spawn(RoundedBoxShape, {
          ...drop,
          width: random.range(20, 60),
          height: random.range(20, 60),
        });
        break;
      case "triangle":
        this.scene.spawn(TriangleShape, {
          ...drop,
          size: random.range(16, 32),
        });
        break;
    }
  }

  /** Pushes every dynamic body upwards. */
  private launchAll(): void {
    for (const entity of this.scene.getEntities()) {
      const body = entity.tryGet(RigidBodyComponent);
      if (body?.type === "dynamic") body.applyImpulse(LAUNCH_IMPULSE);
    }
  }

  private flipGravity(): void {
    this.gravityDown = !this.gravityDown;
    this.world.setGravity(0, this.gravityDown ? GRAVITY : -GRAVITY);
  }
}

/** Hosts the controls. */
class ControlsEntity extends Entity {
  setup(): void {
    this.add(new PhysicsControls());
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class PhysicsBasicsScene extends Scene {
  readonly name = "physics-basics";

  onEnter(): void {
    this.spawn(ControlsEntity);

    // Floor
    this.spawn(WallEntity, {
      x: WIDTH / 2,
      y: HEIGHT - WALL / 2,
      w: WIDTH,
      h: WALL,
      color: 0x444444,
    });
    // Ceiling
    this.spawn(WallEntity, {
      x: WIDTH / 2,
      y: WALL / 2,
      w: WIDTH,
      h: WALL,
      color: 0x333333,
    });
    // Left wall
    this.spawn(WallEntity, {
      x: WALL / 2,
      y: HEIGHT / 2,
      w: WALL,
      h: HEIGHT,
      color: 0x333333,
    });
    // Right wall
    this.spawn(WallEntity, {
      x: WIDTH - WALL / 2,
      y: HEIGHT / 2,
      w: WALL,
      h: HEIGHT,
      color: 0x333333,
    });
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(new PhysicsPlugin());
  engine.use(
    new InputPlugin({
      actions: {
        spawn: ["Space"],
        impulse: ["KeyF"],
        gravity: ["KeyG"],
      },
      preventDefaultKeys: ["Space"],
    }),
  );
  await installDebugFromUrl(engine);

  await engine.start();
  await engine.scenes.push(new PhysicsBasicsScene());
}

main().catch(console.error);
