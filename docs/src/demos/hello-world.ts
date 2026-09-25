import {
  Engine,
  Entity,
  Component,
  RandomKey,
  Scene,
  Transform,
  Vec2,
  ProcessComponent,
  ProcessSlot,
  defineEvent,
} from "@yagejs/core";
import {
  CameraEntity,
  GraphicsComponent,
  RendererPlugin,
} from "@yagejs/renderer";
import {
  PhysicsPlugin,
  RigidBodyComponent,
  ColliderComponent,
} from "@yagejs/physics";
import { UIPlugin, UISurface, Anchor } from "@yagejs/ui";
import type { UIText } from "@yagejs/ui";

// -- Types & Events -----------------------------------------------------------

type Side = "left" | "right";

// Typed event — any entity can emit it, any listener can subscribe
const GoalEvent = defineEvent<{ side: Side }>("goal");

// -- Components ---------------------------------------------------------------

// Components hold game logic. sibling() grabs other components on the same entity.
class PaddleAI extends Component {
  private rb = this.sibling(RigidBodyComponent);
  private transform = this.sibling(Transform);
  private proc = this.sibling(ProcessComponent);
  private ball: Entity;
  private side: Side;

  constructor(ball: Entity, side: Side) {
    super();
    this.ball = ball;
    this.side = side;
  }

  private slot!: ProcessSlot;

  // onAdd runs once when the component is attached to an entity
  onAdd() {
    // ProcessSlot is a timer — fires onComplete every 0.35s
    this.slot = this.proc.slot({
      duration: 0.35,
      onComplete: () => {
        this.react();
        this.slot.restart();
      },
    });
    this.slot.start();
  }

  private react() {
    const ballVel = this.ball.get(RigidBodyComponent).getVelocity();
    // Only move if ball is heading toward us
    const approaching = this.side === "left" ? ballVel.x < 0 : ballVel.x > 0;
    if (!approaching) return;
    const diff =
      this.ball.get(Transform).position.y - this.transform.position.y;
    this.rb.applyImpulse(new Vec2(0, Math.sign(diff) * 100));
  }
}

// -- Entities -----------------------------------------------------------------

// listenScene hears an event that any entity emits. It stops with the component.
class Serve extends Component {
  private rb = this.sibling(RigidBodyComponent);
  private random = this.service(RandomKey); // the scene's seeded generator

  constructor(private center: Vec2) {
    super();
  }

  onAdd() {
    // After a goal, serve again from the centre
    this.listenScene(GoalEvent, ({ side }) =>
      this.launch(side === "right" ? "left" : "right"),
    );
    this.launch(this.random.pick(["left", "right"] as const));
  }

  private launch(toward: Side) {
    this.rb.setPosition(this.center.x, this.center.y);
    this.rb.setVelocity({
      x: (toward === "right" ? 1 : -1) * 250,
      y: this.random.range(-100, 100),
    });
  }
}

// Entities are game objects. setup() receives typed params from scene.spawn().
class Ball extends Entity {
  setup({ w, h }: { w: number; h: number }) {
    const center = new Vec2(w / 2, h / 2);
    this.add(new Transform({ position: center }));
    this.add(
      new GraphicsComponent().draw((g) => g.circle(0, 0, 8).fill(0xffffff)),
    );
    // Dynamic body — moved by physics forces
    this.add(new RigidBodyComponent({ type: "dynamic", fixedRotation: true }));
    this.add(
      new ColliderComponent({
        shape: { type: "circle", radius: 8 },
        restitution: 1, // fully elastic bounce
        friction: 0,
      }),
    );
    this.add(new Serve(center));
  }
}

class Paddle extends Entity {
  setup({
    x,
    y,
    ball,
    side,
  }: {
    x: number;
    y: number;
    ball: Entity;
    side: Side;
  }) {
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent().draw((g) =>
        g.roundRect(-6, -36, 12, 72, 4).fill(0xffffff),
      ),
    );
    // Dynamic but locked horizontally — physics handles vertical movement
    this.add(
      new RigidBodyComponent({
        type: "dynamic",
        fixedRotation: true,
        lockTranslationX: true,
        linearDamping: 2,
      }),
    );
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: 12, height: 72 },
        restitution: 1,
        friction: 0,
      }),
    );
    this.add(new ProcessComponent());
    this.add(new PaddleAI(ball, side));
  }
}

// Static bodies — immovable, used for boundaries
class Wall extends Entity {
  setup({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: w, height: h },
        restitution: 1,
        friction: 0,
      }),
    );
  }
}

// Sensor — detects overlaps without blocking movement
class Goal extends Entity {
  setup({
    x,
    y,
    w,
    h,
    side,
  }: {
    x: number;
    y: number;
    w: number;
    h: number;
    side: Side;
  }) {
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(new RigidBodyComponent({ type: "static" }));
    const collider = new ColliderComponent({
      shape: { type: "box", width: w, height: h },
      sensor: true,
    });
    this.add(collider);
    // When the ball enters this zone, emit a goal event
    collider.onTrigger((ev) => {
      if (ev.entered) this.emit(GoalEvent, { side });
    });
  }
}

// Game state lives in a component: it hears every goal and updates the text
class Score extends Component {
  private points = { left: 0, right: 0 };

  constructor(
    private left: UIText,
    private right: UIText,
  ) {
    super();
  }

  onAdd() {
    this.listenScene(GoalEvent, ({ side }) => {
      this.points[side]++;
      this.left.setText(String(this.points.left));
      this.right.setText(String(this.points.right));
    });
  }
}

// Screen-space UI — anchored to viewport, not affected by camera
class Scoreboard extends Entity {
  setup() {
    const style = { fontSize: 48, fill: 0xffffff, fontFamily: "monospace" };
    const panel = this.add(
      new UISurface({
        anchor: Anchor.TopCenter,
        offset: { x: 0, y: 16 },
        direction: "row",
        gap: 60,
      }),
    );
    this.add(new Score(panel.text("0", style), panel.text("0", style)));
  }
}

// -- Boot ---------------------------------------------------------------------

class PongScene extends Scene {
  readonly name = "pong";
  constructor(
    private W: number,
    private H: number,
  ) {
    super();
  }

  onEnter() {
    this.spawn(CameraEntity, { position: new Vec2(this.W / 2, this.H / 2) });

    this.spawn(Scoreboard);
    const ball = this.spawn(Ball, { w: this.W, h: this.H });
    this.spawn(Paddle, { x: 30, y: this.H / 2, ball, side: "left" });
    this.spawn(Paddle, { x: this.W - 30, y: this.H / 2, ball, side: "right" });
    this.spawn(Wall, { x: this.W / 2, y: -10, w: this.W, h: 20 }); // top
    this.spawn(Wall, { x: this.W / 2, y: this.H + 10, w: this.W, h: 20 }); // bottom
    this.spawn(Goal, {
      x: -20,
      y: this.H / 2,
      w: 20,
      h: this.H,
      side: "left",
    });
    this.spawn(Goal, {
      x: this.W + 20,
      y: this.H / 2,
      w: 20,
      h: this.H,
      side: "right",
    });
  }
}

export default async function (
  container: HTMLElement,
  opts: { width: number; height: number },
) {
  const engine = new Engine();
  engine.use(
    new RendererPlugin({
      width: opts.width,
      height: opts.height,
      backgroundColor: 0x0a0a0a,
      container,
    }),
  );
  engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 0 } }));
  engine.use(new UIPlugin());
  await engine.start();
  engine.scenes.push(new PongScene(opts.width, opts.height));
}
