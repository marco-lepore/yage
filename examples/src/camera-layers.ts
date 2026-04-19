/**
 * Camera Layers — showcases the recent camera/scene refactors:
 *
 *   - Parallax via CameraBinding.translateRatio per layer.
 *   - Declared Scene.layers auto-bound; UI layer auto-provisioned by UIPanel
 *     opts out of auto-binding and stays screen-space.
 *   - Stacked scene with its own CameraEntity — demonstrates that the debug
 *     overlay follows the topmost camera and that removing cameras resets
 *     layer transforms (no stale pan/zoom).
 */
import {
  Engine,
  Scene,
  Component,
  Transform,
  Vec2,
} from "@yagejs/core";
import {
  RendererPlugin,
  GraphicsComponent,
  CameraEntity,
} from "@yagejs/renderer";
import type { LayerDef } from "@yagejs/renderer";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import { UIPlugin, UIPanel, Anchor } from "@yagejs/ui";
import type { UIText } from "@yagejs/ui";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, getContainer } from "./shared.js";

injectStyles();

const WIDTH = 800;
const HEIGHT = 600;
const WORLD_EXTENT = 3000;

// ---------------------------------------------------------------------------
// PlayerController — WASD movement, hud readout, pause push
// ---------------------------------------------------------------------------
class PlayerController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);
  private readonly speed = 0.3;

  constructor(
    private readonly camera: CameraEntity,
    private readonly hudText: UIText,
  ) {
    super();
  }

  onAdd(): void {
    this.camera.follow(this.transform, {
      smoothing: 0.12,
      deadzone: { halfWidth: 40, halfHeight: 30 },
    });
    this.camera.bounds = {
      minX: 0,
      minY: 0,
      maxX: WORLD_EXTENT,
      maxY: WORLD_EXTENT,
    };
  }

  update(dt: number): void {
    const dir = this.input.getVector("left", "right", "up", "down");
    if (dir.x !== 0 || dir.y !== 0) {
      const move = dir.normalize().scale(this.speed * dt);
      this.transform.translate(move.x, move.y);
    }

    if (this.input.isJustPressed("shake")) {
      this.camera.shake(8, 400, { decay: 0.85 });
    }
    if (this.input.isJustPressed("pause")) {
      void engine.scenes.push(new PauseScene());
    }

    const pos = this.transform.position;
    this.hudText.setText(
      `pos (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})  zoom ${this.camera.zoom.toFixed(2)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main scene with parallax layers
// ---------------------------------------------------------------------------
class WorldScene extends Scene {
  readonly name = "world";

  readonly layers: readonly LayerDef[] = [
    { name: "sky", order: -40 },
    { name: "far", order: -30 },
    { name: "mid", order: -20 },
    { name: "world", order: 0 },
  ];

  onEnter(): void {
    this.drawSky();
    this.drawFar();
    this.drawMid();
    this.drawWorld();

    // Camera with explicit bindings so each layer can have its own
    // translateRatio — classic parallax. Omit `bindings` and you'd get
    // the default "follow every declared layer at ratio 1".
    const cam = this.spawn(CameraEntity, {
      bindings: [
        { layer: "sky", translateRatio: 0.1 },
        { layer: "far", translateRatio: 0.3 },
        { layer: "mid", translateRatio: 0.6 },
        { layer: "world", translateRatio: 1 },
      ],
    });

    const player = this.spawn("player");
    player.add(
      new Transform({
        position: new Vec2(WORLD_EXTENT / 2, WORLD_EXTENT / 2),
      }),
    );
    player.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.poly([0, -16, 12, 12, -12, 12]).fill({ color: 0x22c55e });
        g.circle(0, 0, 3).fill({ color: 0xffffff });
      }),
    );

    // HUD — UIPanel auto-provisions the "ui" layer with autoBindable: false,
    // so it stays pinned to top-left as the world scrolls underneath.
    const hud = this.spawn("hud");
    const panel = hud.add(
      new UIPanel({
        anchor: Anchor.TopLeft,
        offset: { x: 16, y: 16 },
        direction: "column",
        gap: 4,
        padding: 12,
        background: { color: 0x000000, alpha: 0.55 },
      }),
    );
    panel.text("Camera Layers", { fontSize: 16, fill: 0xffffff });
    const status = panel.text("", { fontSize: 12, fill: 0x9ca3af });
    panel.text("WASD move • Space shake • P pause", {
      fontSize: 11,
      fill: 0x6b7280,
    });

    player.add(new PlayerController(cam, status));
  }

  private drawSky(): void {
    const sky = this.spawn("sky-backdrop");
    sky.add(new Transform());
    sky.add(
      new GraphicsComponent({ layer: "sky" }).draw((g) => {
        for (let i = 0; i < 200; i++) {
          const x = (i * 131.7) % WORLD_EXTENT;
          const y = (i * 57.3) % WORLD_EXTENT;
          const r = 0.8 + ((i * 13) % 10) * 0.15;
          g.circle(x, y, r).fill({ color: 0xffffff, alpha: 0.4 });
        }
      }),
    );
  }

  private drawFar(): void {
    const far = this.spawn("far-mountains");
    far.add(new Transform());
    far.add(
      new GraphicsComponent({ layer: "far" }).draw((g) => {
        for (let x = 0; x < WORLD_EXTENT; x += 240) {
          const h = 160 + ((x * 11) % 100);
          g.poly([
            x,
            WORLD_EXTENT / 2,
            x + 120,
            WORLD_EXTENT / 2 - h,
            x + 240,
            WORLD_EXTENT / 2,
          ]).fill({ color: 0x1e3a8a, alpha: 0.6 });
        }
      }),
    );
  }

  private drawMid(): void {
    const mid = this.spawn("mid-trees");
    mid.add(new Transform());
    mid.add(
      new GraphicsComponent({ layer: "mid" }).draw((g) => {
        for (let x = 0; x < WORLD_EXTENT; x += 180) {
          const h = 80 + ((x * 7) % 40);
          const baseY = WORLD_EXTENT / 2 + 120;
          g.rect(x, baseY - h, 18, h).fill({ color: 0x065f46, alpha: 0.8 });
          g.circle(x + 9, baseY - h, 20).fill({ color: 0x10b981, alpha: 0.9 });
        }
      }),
    );
  }

  private drawWorld(): void {
    const grid = this.spawn("world-grid");
    grid.add(new Transform());
    grid.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.rect(0, 0, WORLD_EXTENT, WORLD_EXTENT).stroke({
          color: 0x374151,
          width: 2,
        });
        for (let x = 0; x <= WORLD_EXTENT; x += 200) {
          g.moveTo(x, 0).lineTo(x, WORLD_EXTENT).stroke({
            color: 0x1f2937,
            width: 1,
          });
        }
        for (let y = 0; y <= WORLD_EXTENT; y += 200) {
          g.moveTo(0, y).lineTo(WORLD_EXTENT, y).stroke({
            color: 0x1f2937,
            width: 1,
          });
        }
      }),
    );

    for (let i = 0; i < 40; i++) {
      const x = (i * 237.1) % WORLD_EXTENT;
      const y = (i * 341.7) % WORLD_EXTENT;
      const color = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0xa78bfa][i % 4]!;
      const lm = this.spawn(`lm-${i}`);
      lm.add(new Transform({ position: new Vec2(x, y) }));
      lm.add(
        new GraphicsComponent({ layer: "world" }).draw((g) => {
          g.circle(0, 0, 10).fill({ color, alpha: 0.7 });
        }),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Pause scene — stacked on top. Has its own CameraEntity and UI.
// The underlying WorldScene is frozen but its layers retain their last
// camera transform (this was the "stale transform" bug we fixed — layers
// now reset to identity only when *no* camera on any scene is binding them).
// ---------------------------------------------------------------------------
class PauseScene extends Scene {
  override readonly pauseBelow = true;
  override readonly transparentBelow = true;
  readonly name = "pause";

  onEnter(): void {
    // Identity camera. Lets the debug overlay pick this scene's camera
    // via `findTopmostCamera` — verifying the topmost-scene fix.
    this.spawn(CameraEntity);

    const overlay = this.spawn("pause-overlay");
    const panel = overlay.add(
      new UIPanel({
        anchor: Anchor.Center,
        direction: "column",
        gap: 8,
        padding: 24,
        background: { color: 0x000000, alpha: 0.7 },
      }),
    );
    panel.text("PAUSED", { fontSize: 32, fill: 0xffffff });
    panel.text("Press P to resume", { fontSize: 14, fill: 0x9ca3af });

    const ctrl = this.spawn("pause-ctrl");
    ctrl.add(new Transform());
    ctrl.add(new PauseController());
  }
}

class PauseController extends Component {
  private readonly input = this.service(InputManagerKey);

  update(): void {
    if (this.input.isJustPressed("pause")) {
      void engine.scenes.pop();
    }
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0f172a,
    container: getContainer(),
  }),
);
engine.use(
  new InputPlugin({
    actions: {
      up: ["KeyW", "ArrowUp"],
      down: ["KeyS", "ArrowDown"],
      left: ["KeyA", "ArrowLeft"],
      right: ["KeyD", "ArrowRight"],
      shake: ["Space"],
      pause: ["KeyP"],
    },
    preventDefaultKeys: ["Space"],
  }),
);
engine.use(new UIPlugin());
engine.use(new DebugPlugin());

await engine.start();
await engine.scenes.push(new WorldScene());
