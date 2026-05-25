/**
 * UI auto-consume demo: a `MouseLeft`-bound gameplay action firing in the
 * play area, with two UIPanels overlaid — one with the default
 * `consumeInput: true` (suppresses the action), one with
 * `consumeInput: false` (lets clicks pass through).
 *
 * Click anywhere on the canvas to spawn a small particle burst at the click
 * location. The two HUD readouts show:
 *   - "shots fired" — incremented by `onAction("shoot", ...)`
 *   - "ui clicks" — incremented by the panel's `onClick`
 *
 * Click on:
 *   - The play area → shot fires, no UI click. Particle burst appears.
 *   - The "consume" panel (top-left) → UI click fires, NO shot. Panel ate it.
 *   - The "passthrough" panel (top-right) → UI click fires AND shot fires.
 *     `consumeInput: false` opted out of the auto-consume default.
 *   - The button inside the consume panel → button onClick fires, NO shot.
 */
import {
  Component,
  Engine,
  Entity,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import {
  GraphicsComponent,
  RendererPlugin,
} from "@yagejs/renderer";
import type { LayerDef } from "@yagejs/renderer";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import { Anchor, UIPanel, UIPlugin, UIText } from "@yagejs/ui";
import { setupGameContainer } from "./shared.js";

const WIDTH = 800;
const HEIGHT = 600;

class ShotCounter extends Component {
  shots = 0;
}

class UIClickCounter extends Component {
  uiClicks = 0;
}

class Particle extends Entity {
  setup(opts: { position: Vec2; lifetime: number; color: number }): void {
    this.add(new Transform({ position: opts.position }));
    this.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.circle(0, 0, 8).fill({ color: opts.color, alpha: 1 });
      }),
    );
    this.add(new ParticleFader(opts.lifetime));
  }
}

class ParticleFader extends Component {
  private elapsed = 0;
  constructor(private readonly lifetime: number) {
    super();
  }
  update(dt: number): void {
    this.elapsed += dt;
    const t = this.elapsed / this.lifetime;
    if (t >= 1) {
      this.entity.destroy();
      return;
    }
    const fade = 1 - t;
    const sprite = this.entity.get(GraphicsComponent);
    sprite.draw((g) => {
      g.clear();
      g.circle(0, 0, 8 * fade).fill({ color: 0x38bdf8, alpha: fade });
    });
  }
}

class ShootController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly shotCounter: ShotCounter;
  private disposers: Array<() => void> = [];

  constructor(shotCounter: ShotCounter) {
    super();
    this.shotCounter = shotCounter;
  }

  override onAdd(): void {
    this.disposers.push(
      // Action listener: rising edge of `shoot` — fires once per pointerdown
      // that the consume system lets through. Clicks on UI panels with
      // `consumeInput: true` are auto-claimed at drain time, so this never
      // fires for them.
      this.input.onAction("shoot", () => {
        this.shotCounter.shots += 1;
        const pos = this.input.getPointerScreenPosition();
        this.scene.spawn(Particle, {
          position: pos,
          lifetime: 600,
          color: 0x38bdf8,
        });
      }),
    );
  }

  override onDestroy(): void {
    for (const off of this.disposers) off();
    this.disposers.length = 0;
  }
}

class HudUpdater extends Component {
  constructor(
    private readonly text: UIText,
    private readonly shots: ShotCounter,
    private readonly clicks: UIClickCounter,
  ) {
    super();
  }
  update(): void {
    this.text.setText(
      `shots fired: ${this.shots.shots}    ui clicks: ${this.clicks.uiClicks}`,
    );
  }
}

class DemoScene extends Scene {
  readonly name = "ui-consume";

  readonly layers: readonly LayerDef[] = [
    { name: "world", order: 0 },
  ];

  onEnter(): void {
    // -- Counters --
    const counters = this.spawn("counters");
    const shots = counters.add(new ShotCounter());
    const clicks = counters.add(new UIClickCounter());

    // -- Background grid for the play area --
    const grid = this.spawn("grid");
    grid.add(new Transform());
    grid.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.rect(0, 0, WIDTH, HEIGHT).fill({ color: 0x0f172a, alpha: 1 });
        for (let x = 0; x <= WIDTH; x += 50) {
          g.moveTo(x, 0)
            .lineTo(x, HEIGHT)
            .stroke({ color: 0x1e293b, width: 1 });
        }
        for (let y = 0; y <= HEIGHT; y += 50) {
          g.moveTo(0, y)
            .lineTo(WIDTH, y)
            .stroke({ color: 0x1e293b, width: 1 });
        }
      }),
    );

    // -- Shoot controller (listens to `shoot` action) --
    const player = this.spawn("player");
    player.add(new Transform());
    player.add(new ShootController(shots));

    // -- HUD --
    const hudPanel = this.spawn("hud").add(
      new UIPanel({
        anchor: Anchor.BottomCenter,
        offset: { x: 0, y: -20 },
        padding: 10,
        background: { color: 0x000000, alpha: 0.6, radius: 6 },
      }),
    );
    const hudText = hudPanel.text("shots fired: 0    ui clicks: 0", {
      fontFamily: "ui-monospace, Menlo, monospace",
      fontSize: 16,
      fill: 0xe2e8f0,
    });
    this.spawn("hud-updater").add(new HudUpdater(hudText, shots, clicks));

    // -- Consume panel (top-left, default `consumeInput: true`) --
    const consumePanel = this.spawn("ui-consume").add(
      new UIPanel({
        anchor: Anchor.TopLeft,
        offset: { x: 20, y: 20 },
        width: 220,
        height: 90,
        padding: 14,
        background: { color: 0x1f2937, alpha: 0.95, radius: 6 },
      }),
    );
    consumePanel.text("Consume panel", { fontSize: 14, fill: 0xfacc15 });
    consumePanel.text("clicks here are eaten", {
      fontSize: 11,
      fill: 0x94a3b8,
    });
    consumePanel.button("Click me", {
      width: 120,
      height: 28,
      onClick: () => {
        clicks.uiClicks += 1;
      },
    });

    // -- Passthrough panel (top-right, `consumeInput: false`) --
    const passthroughPanel = this.spawn("ui-passthrough").add(
      new UIPanel({
        anchor: Anchor.TopRight,
        offset: { x: -20, y: 20 },
        width: 220,
        height: 90,
        padding: 14,
        background: { color: 0x4c1d95, alpha: 0.6, radius: 6 },
        consumeInput: false,
      }),
    );
    // Children inherit the *default* `consumeInput: true`. To make the
    // entire passthrough panel truly transparent, opt each child out too —
    // a single panel-level prop doesn't cascade down the children list.
    passthroughPanel.addElement(
      new UIText({
        children: "Passthrough panel",
        style: { fontSize: 14, fill: 0xc084fc },
        consumeInput: false,
      }),
    );
    passthroughPanel.addElement(
      new UIText({
        children: "clicks here also fire shots",
        style: { fontSize: 11, fill: 0xa78bfa },
        consumeInput: false,
      }),
    );
  }
}

const engine = new Engine({ debug: true });
const container = setupGameContainer(WIDTH, HEIGHT);

engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0a0a0a,
    container,
  }),
);
engine.use(
  new InputPlugin({
    actions: {
      shoot: ["MouseLeft"],
    },
  }),
);
engine.use(new UIPlugin());

await engine.start();
await engine.scenes.push(new DemoScene());
