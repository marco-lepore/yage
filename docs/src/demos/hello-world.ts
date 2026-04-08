import {
  Entity,
  Component,
  Transform,
  Vec2,
  ProcessComponent,
  ProcessSlot,
  defineEvent,
} from "@yage/core";
import { GraphicsComponent } from "@yage/renderer";
import { RigidBodyComponent, ColliderComponent } from "@yage/physics";
import { UIPanel, Anchor } from "@yage/ui";
import type { UIText } from "@yage/ui";
import { createGame, defineInlineScene } from "yage";

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
    // ProcessSlot is a timer — fires onComplete every 350ms
    this.slot = this.proc.slot({
      duration: 350,
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

// Entities are game objects. setup() receives typed params from scene.spawn().
class Ball extends Entity {
  private w!: number;
  private h!: number;
  private rb!: RigidBodyComponent;

  setup({ w, h }: { w: number; h: number }) {
    this.w = w;
    this.h = h;
    this.add(new Transform({ position: new Vec2(w / 2, h / 2) }));
    this.add(
      new GraphicsComponent().draw((g) => g.circle(0, 0, 8).fill(0xffffff)),
    );
    // Dynamic body — moved by physics forces
    this.rb = new RigidBodyComponent({ type: "dynamic", fixedRotation: true });
    this.add(this.rb);
    this.add(
      new ColliderComponent({
        shape: { type: "circle", radius: 8 },
        restitution: 1, // fully elastic bounce
        friction: 0,
      }),
    );

    // Listen for goals to reset position
    this.scene!.on(GoalEvent, ({ side }) =>
      this.launch(side === "right" ? "left" : "right"),
    );
    this.launch(Math.random() > 0.5 ? "left" : "right");
  }

  private launch(toward: Side) {
    this.rb.setPosition(this.w / 2, this.h / 2);
    const dir = toward === "right" ? 1 : -1;
    this.rb.setVelocity({ x: dir * 250, y: (Math.random() - 0.5) * 200 });
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

// Screen-space UI — anchored to viewport, not affected by camera
class Scoreboard extends Entity {
  private leftText!: UIText;
  private rightText!: UIText;
  private score = { left: 0, right: 0 };

  setup() {
    const panel = this.add(
      new UIPanel({
        anchor: Anchor.TopCenter,
        offset: { x: 0, y: 16 },
        direction: "row",
        gap: 60,
      }),
    );
    const style = { fontSize: 48, fill: 0xffffff, fontFamily: "monospace" };
    this.leftText = panel.text("0", style);
    this.rightText = panel.text("0", style);

    this.scene!.on(GoalEvent, ({ side }) => {
      this.score[side]++;
      this.leftText.setText(String(this.score.left));
      this.rightText.setText(String(this.score.right));
    });
  }
}

// -- Boot ---------------------------------------------------------------------

export default async function (
  container: HTMLElement,
  opts: { width: number; height: number },
) {
  const W = opts.width;
  const H = opts.height;

  await createGame({
    width: W,
    height: H,
    backgroundColor: 0x0a0a0a,
    container,
    physics: { gravity: { x: 0, y: 0 } },
    ui: true,
    scene: defineInlineScene("pong", (scene, { camera }) => {
      camera.position = new Vec2(W / 2, H / 2);

      scene.spawn(Scoreboard);
      const ball = scene.spawn(Ball, { w: W, h: H });
      scene.spawn(Paddle, { x: 30, y: H / 2, ball, side: "left" });
      scene.spawn(Paddle, { x: W - 30, y: H / 2, ball, side: "right" });
      scene.spawn(Wall, { x: W / 2, y: -10, w: W, h: 20 }); // top
      scene.spawn(Wall, { x: W / 2, y: H + 10, w: W, h: 20 }); // bottom
      scene.spawn(Goal, { x: -20, y: H / 2, w: 20, h: H, side: "left" });
      scene.spawn(Goal, { x: W + 20, y: H / 2, w: 20, h: H, side: "right" });
    }),
  });
}
