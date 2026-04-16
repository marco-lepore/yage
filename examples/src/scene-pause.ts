import { Engine, Scene, Component, Transform, Vec2 } from "@yagejs/core";
import { RendererPlugin, CameraKey, GraphicsComponent } from "@yagejs/renderer";
import { PhysicsPlugin, RigidBodyComponent, ColliderComponent } from "@yagejs/physics";
import { UIPlugin, UIPanel, Anchor } from "@yagejs/ui";
import type { UIText } from "@yagejs/ui";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import { injectStyles, getContainer } from "./shared.js";
import { textStyle, loadFonts, allAssets, nineSliceBtn, panelBg } from "./ui-theme.js";

injectStyles();

const WIDTH = 800;
const HEIGHT = 600;
const WALL = 20;
const PALETTE = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0xa78bfa, 0xf97316, 0x38bdf8];

// ---------------------------------------------------------------------------
// GameScene — bouncing physics balls with HUD and timeScale control
// ---------------------------------------------------------------------------
// The HUD panel lives in GameScene so it always renders (UI layout runs on all
// scenes, even paused ones). The HudUpdater component updates text each frame
// while the game is active; when paused, the text freezes — which is fine
// because the pause menu itself makes the state obvious.
// ---------------------------------------------------------------------------
class GameScene extends Scene {
  readonly name = "game";
  readonly preload = [...allAssets];

  /** Exposed so PauseScene can update the HUD status text on enter/exit. */
  statusText!: UIText;
  tsText!: UIText;

  onEnter(): void {
    const camera = this.context.resolve(CameraKey);
    camera.position = new Vec2(WIDTH / 2, HEIGHT / 2);

    // Walls
    this.wall(WIDTH / 2, HEIGHT - WALL / 2, WIDTH, WALL);
    this.wall(WIDTH / 2, WALL / 2, WIDTH, WALL);
    this.wall(WALL / 2, HEIGHT / 2, WALL, HEIGHT);
    this.wall(WIDTH - WALL / 2, HEIGHT / 2, WALL, HEIGHT);

    // Initial balls
    for (let i = 0; i < 8; i++) this.spawnBall();

    // Input controller
    const ctrl = this.spawn("controller");
    ctrl.add(new Transform());
    ctrl.add(new GameController());

    // HUD (part of GameScene — renders even when paused)
    const hudEntity = this.spawn("hud");
    const hud = hudEntity.add(
      new UIPanel({
        anchor: Anchor.TopLeft,
        offset: { x: 16, y: 16 },
        direction: "column",
        gap: 4,
        padding: 16,
        background: panelBg,
      }),
    );
    hud.text("Scene Pause Demo", textStyle("title", { fontSize: 16 }));
    this.tsText = hud.text("TimeScale: 1.0x", textStyle("body", { fill: 0xfacc15 }));
    this.statusText = hud.text("Status: Running", textStyle("body", { fill: 0x22c55e }));

    hudEntity.add(new HudUpdater());
  }

  spawnBall(): void {
    const x = 100 + Math.random() * (WIDTH - 200);
    const y = 60 + Math.random() * 200;
    const r = 12 + Math.random() * 16;
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)]!;
    const e = this.spawn("ball");
    e.add(new Transform({ position: new Vec2(x, y) }));
    e.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, r).fill({ color, alpha: 0.85 });
        g.circle(0, 0, r).stroke({ color: 0xffffff, width: 1, alpha: 0.3 });
      }),
    );
    e.add(new RigidBodyComponent({ type: "dynamic", ccd: true }));
    e.add(new ColliderComponent({ shape: { type: "circle", radius: r }, restitution: 0.7, density: 1 }));
  }

  private wall(x: number, y: number, w: number, h: number): void {
    const e = this.spawn("wall");
    e.add(new Transform({ position: new Vec2(x, y) }));
    e.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color: 0x333333 });
      }),
    );
    e.add(new RigidBodyComponent({ type: "static" }));
    e.add(new ColliderComponent({ shape: { type: "box", width: w, height: h }, restitution: 0.5 }));
  }
}

// ---------------------------------------------------------------------------
// GameController — timeScale keys + pause toggle + spawn
// ---------------------------------------------------------------------------
class GameController extends Component {
  private readonly input = this.service(InputManagerKey);

  update(): void {
    const scene = this.scene as GameScene;

    if (this.input.isJustPressed("slowMo")) scene.timeScale = 0.25;
    if (this.input.isJustPressed("normal")) scene.timeScale = 1;
    if (this.input.isJustPressed("fast")) scene.timeScale = 2;

    if (this.input.isJustPressed("pause")) {
      void engine.scenes.push(new PauseScene());
    }

    if (this.input.isJustPressed("spawn")) {
      scene.spawnBall();
    }
  }
}

// ---------------------------------------------------------------------------
// HudUpdater — updates timeScale text while game is active
// ---------------------------------------------------------------------------
class HudUpdater extends Component {
  update(): void {
    const game = this.scene as GameScene;
    game.tsText.setText(`TimeScale: ${game.timeScale}x`);
  }
}

// ---------------------------------------------------------------------------
// PauseScene — freezes everything below (pauseBelow=true)
// ---------------------------------------------------------------------------
class PauseScene extends Scene {
  readonly name = "pause-menu";
  override readonly pauseBelow = true;
  override readonly transparentBelow = true;

  onEnter(): void {
    // Update HUD status text directly (since HudUpdater is paused)
    const game = engine.scenes.all.find((s) => s.name === "game") as GameScene | undefined;
    game?.statusText.setText("Status: PAUSED");

    const entity = this.spawn("pause-ui");
    const panel = entity.add(
      new UIPanel({
        anchor: Anchor.Center,
        direction: "column",
        gap: 12,
        padding: 32,
        alignItems: "center",
        background: panelBg,
      }),
    );

    panel.text("PAUSED", textStyle("title", { fontSize: 28 }));
    panel.text("Physics and game logic are frozen", textStyle("subtitle"));

    panel.button("Resume", {
      width: 220, height: 40,
      textStyle: textStyle("button"),
      onClick: () => engine.scenes.pop(),
      ...nineSliceBtn,
    });

    panel.button("Resume in Slow-Mo (0.25x)", {
      width: 220, height: 40,
      textStyle: textStyle("button"),
      onClick: () => {
        if (game) game.timeScale = 0.25;
        engine.scenes.pop();
      },
      ...nineSliceBtn,
    });

    panel.button("Resume at Normal Speed", {
      width: 220, height: 40,
      textStyle: textStyle("button"),
      onClick: () => {
        if (game) game.timeScale = 1;
        engine.scenes.pop();
      },
      ...nineSliceBtn,
    });

    // Escape to resume
    const esc = this.spawn("esc-handler");
    esc.add(new Transform());
    esc.add(new PauseEscHandler());
  }

  onExit(): void {
    const game = engine.scenes.all.find((s) => s.name === "game") as GameScene | undefined;
    game?.statusText.setText("Status: Running");
  }
}

class PauseEscHandler extends Component {
  private readonly input = this.service(InputManagerKey);

  update(): void {
    if (this.input.isJustPressed("pause")) {
      engine.scenes.pop();
    }
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
let engine: Engine;

async function main() {
  engine = new Engine({ debug: true });

  engine.use(new RendererPlugin({
    width: WIDTH, height: HEIGHT,
    virtualWidth: WIDTH, virtualHeight: HEIGHT,
    backgroundColor: 0x0a0a0a,
    container: getContainer(),
  }));
  engine.use(new PhysicsPlugin());
  engine.use(new InputPlugin({
    actions: {
      slowMo: ["Digit1"],
      normal: ["Digit2"],
      fast: ["Digit3"],
      pause: ["Escape"],
      spawn: ["Space"],
    },
    preventDefaultKeys: ["Space"],
  }));
  engine.use(new UIPlugin());

  await loadFonts();
  await engine.start();
  await engine.scenes.push(new GameScene());
}

main().catch(console.error);
