import {
  Component,
  Engine,
  Entity,
  ProcessComponent,
  Scene,
  Sequence,
  Transform,
  Vec2,
} from "@yagejs/core";
import {
  GraphicsComponent,
  RendererPlugin,
  TextComponent,
} from "@yagejs/renderer";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";
import { GuardEntity } from "./guard.js";

const WIDTH = 800;
const HEIGHT = 540;

class Demonstration extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly processes = this.sibling(ProcessComponent);

  constructor(
    private readonly first: GuardEntity,
    private readonly second: GuardEntity,
  ) {
    super();
  }

  onAdd(): void {
    this.processes.run(
      new Sequence()
        .wait(1.8)
        .call(() => this.first.state.damage())
        .wait(1)
        .call(() => this.second.state.damage())
        .build(),
    );
  }

  update(): void {
    if (this.input.isJustPressed("hurt-first")) this.first.state.damage();
    if (this.input.isJustPressed("hurt-second")) this.second.state.damage();
    if (this.input.isJustPressed("toggle-first"))
      this.first.brain.enabled = !this.first.brain.enabled;
  }
}

class DemoEntity extends Entity {
  setup(params: { first: GuardEntity; second: GuardEntity }): void {
    this.add(new ProcessComponent());
    this.add(new Demonstration(params.first, params.second));
  }
}

class PanelEntity extends Entity {
  text!: TextComponent;
  setup(params: { y: number }): void {
    this.add(new Transform({ position: new Vec2(30, params.y) }));
    this.text = this.add(
      new TextComponent({
        text: "",
        layer: "hud",
        style: { fontFamily: "monospace", fontSize: 16, fill: 0xcbd5e1 },
      }),
    );
  }
}

class BehaviorScene extends Scene {
  readonly name = "behavior-tree";
  readonly layers = [
    { name: "world", order: 0 },
    { name: "hud", order: 1000, space: "screen" as const },
  ];
  onEnter(): void {
    this.spawn("lanes").add(
      new GraphicsComponent().draw((g) => {
        for (const y of [180, 390]) {
          g.roundRect(55, y - 45, 690, 90, 12).fill({ color: 0x1e293b });
          g.circle(100, y, 26).stroke({ color: 0x4ade80, width: 2 });
          g.rect(684, y - 22, 20, 44).fill({ color: 0x64748b });
        }
      }),
    );
    const firstPanel = this.spawn(PanelEntity, { y: 65 });
    const secondPanel = this.spawn(PanelEntity, { y: 275 });
    const first = this.spawn(
      GuardEntity,
      {
        lane: "Guard A",
        x: 570,
        y: 180,
        panel: firstPanel.text,
      },
      { key: "guard-a" },
    );
    const second = this.spawn(
      GuardEntity,
      {
        lane: "Guard B",
        x: 180,
        y: 390,
        panel: secondPanel.text,
      },
      { key: "guard-b" },
    );
    this.spawn(DemoEntity, { first, second });
  }
}

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0f172a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(
    new InputPlugin({
      actions: {
        "hurt-first": ["Digit1"],
        "hurt-second": ["Digit2"],
        "toggle-first": ["Space"],
      },
    }),
  );
  await installDebugFromUrl(engine);
  await engine.start();
  await engine.scenes.push(new BehaviorScene());
}
main().catch(console.error);
