/**
 * Scene stack demo — also doubles as the manual-test fixture for the
 * `Scene.transparentBelow` semantics:
 *
 * - GameScene (bottom) — bouncing physics balls with a HUD panel.
 * - PauseScene (Esc on game) — `transparentBelow=true`; the game stays
 *   visible behind the menu, paused.
 * - SettingsScene (Settings button on pause) — default
 *   `transparentBelow=false`; both the game HUD and the pause menu are
 *   hidden by the renderer while this is on top, then re-shown on pop.
 *
 * The game's speed and pause status live in a `Playback` component on the
 * game scene's HUD entity. The pause menu finds the game scene through the
 * scene manager and reaches the component with `findByKey`.
 */
import {
  Component,
  Engine,
  Entity,
  RandomKey,
  Scene,
  SceneManagerKey,
  Transform,
  Vec2,
} from "@yagejs/core";
import type { RandomService } from "@yagejs/core";
import { RendererPlugin, GraphicsComponent } from "@yagejs/renderer";
import {
  PhysicsPlugin,
  RigidBodyComponent,
  ColliderComponent,
} from "@yagejs/physics";
import { UIPlugin, UISurface, Anchor } from "@yagejs/ui";
import type { UIText } from "@yagejs/ui";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";
import {
  textStyle,
  allAssets,
  nineSliceBtn,
  panelBg,
} from "../shared/ui-theme.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WIDTH = 800;
const HEIGHT = 600;
const WALL = 20;
const INITIAL_BALLS = 8;
const PALETTE = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0xa78bfa, 0xf97316, 0x38bdf8];

const GAME_SCENE = "game";
/** Spawn key of the game scene's HUD entity, for `scene.findByKey`. */
const HUD_KEY = "hud";

// ---------------------------------------------------------------------------
// Walls and balls
// ---------------------------------------------------------------------------
class WallEntity extends Entity {
  setup(params: { x: number; y: number; w: number; h: number }): void {
    const { x, y, w, h } = params;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color: 0x333333 });
      }),
    );
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: w, height: h },
        restitution: 0.5,
      }),
    );
  }
}

interface BallParams {
  position: Vec2;
  radius: number;
  color: number;
}

class BallEntity extends Entity {
  setup(params: BallParams): void {
    const { position, radius, color } = params;
    this.add(new Transform({ position }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, radius).fill({ color, alpha: 0.85 });
        g.circle(0, 0, radius).stroke({
          color: 0xffffff,
          width: 1,
          alpha: 0.3,
        });
      }),
    );
    this.add(new RigidBodyComponent({ type: "dynamic", ccd: true }));
    this.add(
      new ColliderComponent({
        shape: { type: "circle", radius },
        restitution: 0.7,
        density: 1,
      }),
    );
  }
}

/** A ball of random size and colour somewhere near the top of the box. */
function randomBall(random: RandomService): BallParams {
  return {
    position: new Vec2(random.range(100, WIDTH - 100), random.range(60, 260)),
    radius: random.range(12, 28),
    color: random.pick(PALETTE),
  };
}

// ---------------------------------------------------------------------------
// HUD — the game's speed and pause status
// ---------------------------------------------------------------------------

/**
 * The game scene's time scale and pause status, and the HUD lines that show
 * them. Other code reaches it with
 * `scene.findByKey<HudEntity>(HUD_KEY)?.playback`.
 */
class Playback extends Component {
  constructor(private readonly texts: { speed: UIText; status: UIText }) {
    super();
  }

  get speed(): number {
    return this.scene.timeScale;
  }

  get paused(): boolean {
    return this.scene.isPaused;
  }

  onAdd(): void {
    this.refresh();
  }

  setSpeed(scale: number): void {
    this.scene.timeScale = scale;
    this.refresh();
  }

  /** Rewrites both HUD lines from the scene's current state. */
  refresh(): void {
    this.texts.speed.setText(`TimeScale: ${this.speed}x`);
    this.texts.status.setText(
      this.paused ? "Status: PAUSED" : "Status: Running",
    );
  }
}

/**
 * HUD panel in the top-left corner. It lives in the game scene, so it keeps
 * rendering while a menu pauses the game.
 */
class HudEntity extends Entity {
  playback!: Playback;

  setup(): void {
    const hud = this.add(
      new UISurface({
        anchor: Anchor.TopLeft,
        offset: { x: 16, y: 16 },
        direction: "column",
        gap: 4,
        padding: 16,
        background: panelBg,
      }),
    );
    hud.text("Scene Pause Demo", textStyle("title", { fontSize: 16 }));
    const speed = hud.text("", textStyle("body", { fill: 0xfacc15 }));
    const status = hud.text("", textStyle("body", { fill: 0x22c55e }));
    this.playback = this.add(new Playback({ speed, status }));
  }
}

// ---------------------------------------------------------------------------
// GameController — time scale keys, pause, and dropping balls
// ---------------------------------------------------------------------------
class GameController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly scenes = this.service(SceneManagerKey);
  private readonly random = this.service(RandomKey);

  update(): void {
    if (this.input.isJustPressed("slowMo")) this.setSpeed(0.25);
    if (this.input.isJustPressed("normal")) this.setSpeed(1);
    if (this.input.isJustPressed("fast")) this.setSpeed(2);

    if (this.input.isJustPressed("pause")) {
      void this.scenes.push(new PauseScene());
    }

    if (this.input.isJustPressed("spawn")) {
      this.scene.spawn(BallEntity, randomBall(this.random));
    }
  }

  private setSpeed(scale: number): void {
    this.scene.findByKey<HudEntity>(HUD_KEY)?.playback.setSpeed(scale);
  }
}

class ControllerEntity extends Entity {
  setup(): void {
    this.add(new GameController());
  }
}

// ---------------------------------------------------------------------------
// GameScene — bouncing physics balls with HUD and timeScale control
// ---------------------------------------------------------------------------
class GameScene extends Scene {
  readonly name = GAME_SCENE;
  readonly preload = [...allAssets];

  onEnter(): void {
    this.spawn(WallEntity, {
      x: WIDTH / 2,
      y: HEIGHT - WALL / 2,
      w: WIDTH,
      h: WALL,
    });
    this.spawn(WallEntity, { x: WIDTH / 2, y: WALL / 2, w: WIDTH, h: WALL });
    this.spawn(WallEntity, { x: WALL / 2, y: HEIGHT / 2, w: WALL, h: HEIGHT });
    this.spawn(WallEntity, {
      x: WIDTH - WALL / 2,
      y: HEIGHT / 2,
      w: WALL,
      h: HEIGHT,
    });

    const random = this.use(RandomKey);
    for (let i = 0; i < INITIAL_BALLS; i++) {
      this.spawn(BallEntity, randomBall(random));
    }

    this.spawn(ControllerEntity);
    this.spawn(HudEntity, { key: HUD_KEY });
  }

  // A paused scene's components get no update(), so the pause hooks tell
  // the HUD to show the new status.
  onPause(): void {
    this.findByKey<HudEntity>(HUD_KEY)?.playback.refresh();
  }

  onResume(): void {
    this.findByKey<HudEntity>(HUD_KEY)?.playback.refresh();
  }
}

// ---------------------------------------------------------------------------
// PauseScene — freezes everything below (pauseBelow=true)
// ---------------------------------------------------------------------------

/** What the pause menu's buttons and the Esc key do. */
class PauseMenu extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly scenes = this.service(SceneManagerKey);

  update(): void {
    if (this.input.isJustPressed("pause")) this.resume();
  }

  /** Closes the menu. With a `speed`, the game resumes at that time scale. */
  resume(speed?: number): void {
    if (speed !== undefined) this.gamePlayback()?.setSpeed(speed);
    void this.scenes.pop();
  }

  openSettings(): void {
    void this.scenes.push(new SettingsScene());
  }

  /** The game scene is below the menu on the stack; its HUD holds the speed. */
  private gamePlayback(): Playback | undefined {
    const game = this.scenes.all.find((scene) => scene.name === GAME_SCENE);
    return game?.findByKey<HudEntity>(HUD_KEY)?.playback;
  }
}

class PauseMenuEntity extends Entity {
  setup(): void {
    const menu = this.add(new PauseMenu());
    // alignItems: "stretch" with auto-sized buttons: the widest button's
    // natural label (Settings + the parenthetical) defines the panel's
    // content width, and the shorter buttons stretch to match — uniform
    // stack without picking an explicit width that risks overflowing.
    const panel = this.add(
      new UISurface({
        anchor: Anchor.Center,
        direction: "column",
        gap: 12,
        padding: 32,
        alignItems: "stretch",
        background: panelBg,
      }),
    );

    panel.text("PAUSED", textStyle("title", { fontSize: 28 }));
    panel.text("Physics and game logic are frozen", textStyle("subtitle"));

    panel.button("Resume", {
      textStyle: textStyle("button"),
      onClick: () => menu.resume(),
      ...nineSliceBtn,
    });

    panel.button("Resume in Slow-Mo (0.25x)", {
      textStyle: textStyle("button"),
      onClick: () => menu.resume(0.25),
      ...nineSliceBtn,
    });

    panel.button("Resume at Normal Speed", {
      textStyle: textStyle("button"),
      onClick: () => menu.resume(1),
      ...nineSliceBtn,
    });

    // Pushing a scene with the default `transparentBelow=false` hides every
    // below-stack scene's render tree — game HUD AND this pause menu.
    // Compare with the Resume buttons above, which pop the pause overlay
    // and uncover the running game.
    panel.button("Settings (transparentBelow=false)", {
      textStyle: textStyle("button"),
      onClick: () => menu.openSettings(),
      ...nineSliceBtn,
    });
  }
}

class PauseScene extends Scene {
  readonly name = "pause-menu";
  override readonly pauseBelow = true;
  override readonly transparentBelow = true;

  onEnter(): void {
    this.spawn(PauseMenuEntity);
  }
}

// ---------------------------------------------------------------------------
// SettingsScene — full-screen overlay using DEFAULT transparentBelow=false
// ---------------------------------------------------------------------------
// Pushed from the pause menu. Because `transparentBelow` defaults to
// `false`, the renderer hides every below-stack scene's tree while this
// scene is on top — the game's HUD and the pause menu BOTH stop rendering,
// and the settings panel sits on a black canvas. Pop to reveal them again.
// ---------------------------------------------------------------------------

/** Back button and Esc both close the settings. */
class SettingsMenu extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly scenes = this.service(SceneManagerKey);

  update(): void {
    if (this.input.isJustPressed("pause")) this.back();
  }

  back(): void {
    void this.scenes.pop();
  }
}

class SettingsMenuEntity extends Entity {
  setup(): void {
    const menu = this.add(new SettingsMenu());
    const panel = this.add(
      new UISurface({
        anchor: Anchor.Center,
        direction: "column",
        gap: 12,
        padding: 32,
        alignItems: "stretch",
        background: panelBg,
      }),
    );

    panel.text("SETTINGS", textStyle("title", { fontSize: 28 }));
    panel.text(
      "transparentBelow = false ⇒ pause menu + game HUD are hidden",
      textStyle("subtitle"),
    );

    panel.button("Back", {
      textStyle: textStyle("button"),
      onClick: () => menu.back(),
      ...nineSliceBtn,
    });
  }
}

class SettingsScene extends Scene {
  readonly name = "settings";
  override readonly pauseBelow = true;
  // `transparentBelow` is left at the default `false` deliberately —
  // declaring it here just for the demo's visibility.
  override readonly transparentBelow = false;

  onEnter(): void {
    this.spawn(SettingsMenuEntity);
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
      virtualWidth: WIDTH,
      virtualHeight: HEIGHT,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(new PhysicsPlugin());
  engine.use(
    new InputPlugin({
      actions: {
        slowMo: ["Digit1"],
        normal: ["Digit2"],
        fast: ["Digit3"],
        pause: ["Escape"],
        spawn: ["Space"],
      },
      preventDefaultKeys: ["Space"],
    }),
  );
  engine.use(new UIPlugin());
  await installDebugFromUrl(engine);

  await engine.start();
  await engine.scenes.push(new GameScene());
}

main().catch(console.error);
