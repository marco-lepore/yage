import {
  Component,
  Engine,
  Entity,
  InspectorPlugin,
  MathUtils,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import {
  GraphicsComponent,
  RendererPlugin,
  TextComponent,
} from "@yagejs/renderer";
import type { PhysicsWorld } from "@yagejs/physics";
import type { LayerDef } from "@yagejs/renderer";
import {
  ColliderComponent,
  PhysicsPlugin,
  PhysicsWorldKey,
  RigidBodyComponent,
} from "@yagejs/physics";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import {
  PerceptionDetectedEvent,
  PerceptionForgottenEvent,
  PerceptionLostEvent,
  PerceptionSensor,
} from "@yagejs-addons/perception";
import { perceptionRaycast } from "@yagejs-addons/perception/physics";
import { setupGameContainer } from "../shared/bootstrap.js";

const WIDTH = 840;
const HEIGHT = 560;
const RANGE = 420;
const FOV = (Math.PI * 2) / 3;

/** Game-owned visibility policy input, independent of lighting. */
class TargetControl extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);
  private readonly visual = this.sibling(GraphicsComponent);
  concealed = false;
  update(dt: number): void {
    const input = this.input;
    if (input.isJustPressed("clear")) this.transform.setPosition(300, 310);
    if (input.isJustPressed("cover")) this.transform.setPosition(530, 310);
    if (input.isJustPressed("far")) this.transform.setPosition(760, 310);
    if (input.isJustPressed("behind")) this.transform.setPosition(70, 310);
    if (input.isJustPressed("conceal")) this.concealed = !this.concealed;
    const movement = input.getVector("left", "right", "up", "down");
    const direction = movement.lengthSq() > 0 ? movement.normalize() : movement;
    const p = this.transform.position;
    this.transform.setPosition(
      MathUtils.clamp(p.x + direction.x * 180 * dt, 20, WIDTH - 20),
      MathUtils.clamp(p.y + direction.y * 180 * dt, 160, HEIGHT - 25),
    );
    this.visual.alpha = this.concealed ? 0.3 : 1;
  }
}
class Target extends Entity {
  setup(): void {
    this.tags.add("perceptible");
    this.add(new Transform({ position: new Vec2(300, 310) }));
    this.add(
      new GraphicsComponent().draw((g) => g.circle(0, 0, 11).fill(0x75caff)),
    );
    this.add(new TargetControl());
  }
}
class Wall extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(425, 310) }));
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({ shape: { type: "box", width: 28, height: 150 } }),
    );
    this.add(
      new GraphicsComponent().draw((g) =>
        g.roundRect(-14, -75, 28, 150, 5).fill(0x687589),
      ),
    );
  }
}
/** A replaceable game reaction: face the last known point, or hold the heading. */
class ObserverReaction extends Component {
  private readonly sensor = this.sibling(PerceptionSensor);
  private readonly transform = this.sibling(Transform);
  private readonly input = this.service(InputManagerKey);
  tracking = false;
  detections = 0;
  losses = 0;
  forgotten = 0;
  onAdd(): void {
    this.listen(this.entity, PerceptionDetectedEvent, () => {
      this.detections++;
    });
    this.listen(this.entity, PerceptionLostEvent, () => {
      this.losses++;
    });
    this.listen(this.entity, PerceptionForgottenEvent, () => {
      this.forgotten++;
    });
  }
  update(): void {
    if (this.input.isJustPressed("reaction")) this.tracking = !this.tracking;
    const known = this.sensor.observations[0];
    if (this.tracking && known) {
      const p = this.transform.worldPosition;
      this.transform.setRotation(
        Math.atan2(known.lastPosition.y - p.y, known.lastPosition.x - p.x),
      );
    }
    if (!this.tracking) this.transform.setRotation(0);
  }
}
class Observer extends Entity {
  setup(params: { world: PhysicsWorld }): void {
    this.add(new Transform({ position: new Vec2(180, 310) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.moveTo(0, 0)
          .arc(0, 0, RANGE, -FOV / 2, FOV / 2)
          .lineTo(0, 0)
          .fill({ color: 0x608466, alpha: 0.12 });
        g.circle(0, 0, 13).fill(0x86de9b);
        g.moveTo(0, 0).lineTo(24, 0).stroke({ color: 0xe4ffeb, width: 3 });
      }),
    );
    this.add(
      new PerceptionSensor({
        range: RANGE,
        loseRange: RANGE + 25,
        fieldOfView: FOV,
        memoryDuration: 3,
        lineOfSight: perceptionRaycast(params.world),
        visibility: ({ target }) =>
          target.get(TargetControl).concealed ? 0.1 : 1,
        visibilityThreshold: 0.5,
      }),
    );
    this.add(new ObserverReaction());
  }
}
class Readout extends Component {
  private readonly text = this.sibling(TextComponent);
  constructor(
    private readonly observer: Observer,
    private readonly trace: GraphicsComponent,
  ) {
    super();
  }
  update(): void {
    const sensor = this.observer.get(PerceptionSensor);
    const reaction = this.observer.get(ObserverReaction);
    const known = sensor.observations[0];
    const status = known?.visible
      ? "Detected"
      : known
        ? "Lost; remembering last position"
        : "No remembered target";
    const evaluation = sensor.evaluations[0];
    const age = sensor.diagnostics[0]?.age ?? 0;
    this.text.setText(
      `${status}\nReason: ${evaluation?.reason ?? "clear sight"}  |  Last seen: ${age.toFixed(1)} s ago\nReaction: ${reaction.tracking ? "face last known position" : "hold heading"}  |  Detected ${reaction.detections}  Lost ${reaction.losses}  Forgotten ${reaction.forgotten}`,
    );
    this.trace.draw((g) => {
      g.clear();
      if (!known) return;
      const p = this.observer.get(Transform).worldPosition;
      const color = known.visible ? 0x86de9b : 0xf4be69;
      g.moveTo(p.x, p.y)
        .lineTo(known.lastPosition.x, known.lastPosition.y)
        .stroke({ color, width: 2, alpha: 0.7 });
      g.circle(known.lastPosition.x, known.lastPosition.y, 17).stroke({
        color,
        width: 2,
      });
    });
  }
}
class PerceptionScene extends Scene {
  readonly name = "perception";
  readonly layers: readonly LayerDef[] = [
    { name: "default", order: 0 },
    { name: "hud", order: 1000, space: "screen" },
  ];
  onEnter(): void {
    const observer = this.spawn(
      Observer,
      { world: this.use(PhysicsWorldKey) },
      { key: "observer" },
    );
    this.spawn(Wall);
    this.spawn(Target, { key: "target" });
    const trace = this.spawn("sight-trace");
    trace.add(new Transform());
    const graphics = trace.add(new GraphicsComponent());
    const hud = this.spawn("readout");
    hud.add(new Transform({ position: new Vec2(22, 22) }));
    hud.add(
      new TextComponent({
        text: "",
        layer: "hud",
        style: {
          fontFamily: "monospace",
          fontSize: 15,
          fill: 0xe4eaf2,
          lineHeight: 25,
        },
      }),
    );
    hud.add(new Readout(observer, graphics));
  }
}
async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(new InspectorPlugin());
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x121923,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 0 } }));
  engine.use(
    new InputPlugin({
      actions: {
        left: ["KeyA", "ArrowLeft"],
        right: ["KeyD", "ArrowRight"],
        up: ["KeyW", "ArrowUp"],
        down: ["KeyS", "ArrowDown"],
        clear: ["Digit1"],
        cover: ["Digit2"],
        far: ["Digit3"],
        behind: ["Digit4"],
        conceal: ["KeyC"],
        reaction: ["KeyR"],
      },
      preventDefaultKeys: ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"],
    }),
  );
  await engine.start();
  await engine.scenes.push(new PerceptionScene());
}
main().catch(console.error);
