import {
  Component,
  Engine,
  Entity,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import {
  CameraEntity,
  GraphicsComponent,
  RendererPlugin,
  ScreenFollow,
} from "@yagejs/renderer";
import type { LayerDef } from "@yagejs/renderer";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import { Anchor, UIPanel, UIPlugin, UIProgressBar } from "@yagejs/ui";
import { getContainer } from "./shared.js";

const WIDTH = 800;
const HEIGHT = 600;
const WORLD = 2000;

// ---------------------------------------------------------------------------
// Health state
// ---------------------------------------------------------------------------
class Health extends Component {
  max: number;
  current: number;

  constructor(opts: { max: number }) {
    super();
    this.max = opts.max;
    this.current = opts.max;
  }

  get ratio(): number {
    return this.current / this.max;
  }

  damage(amount: number): void {
    this.current = Math.max(0, this.current - amount);
  }
}

// ---------------------------------------------------------------------------
// Enemy body (child of Enemy): a triangle that rotates to face the player.
// Rotation lives on the Body so the logical root stays stable.
// ---------------------------------------------------------------------------
class EnemyBody extends Entity {
  setup(params: { color: number }): void {
    const transform = this.add(new Transform());
    this.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.poly([0, -16, 14, 12, -14, 12]).fill({ color: params.color });
        g.poly([0, -16, 14, 12, -14, 12]).stroke({
          color: 0xffffff,
          alpha: 0.8,
          width: 1.5,
        });
      }),
    );
    this.add(new FaceTowardsPlayer(transform));
  }
}

class FaceTowardsPlayer extends Component {
  constructor(private readonly localTransform: Transform) {
    super();
  }

  update(): void {
    const player = this.scene.findEntity("player");
    if (!player) return;
    const parent = this.entity.parent;
    if (!parent) return;
    const myWorld = parent.get(Transform).worldPosition;
    const target = player.get(Transform).worldPosition;
    const delta = target.sub(myWorld);
    // Parent Enemy doesn't rotate, so local = world for this Transform.
    this.localTransform.setRotation(Math.atan2(delta.y, delta.x) + Math.PI / 2);
  }
}

// ---------------------------------------------------------------------------
// Enemy nameplate — independent entity, sits above the enemy via ScreenFollow.
// ScreenFollow writes camera.worldToScreen(target + offset) to this entity's
// Transform each frame; UIPanel with positioning: "transform" reads that
// position on the auto-provisioned screen-space "ui" layer.
// ---------------------------------------------------------------------------
class EnemyNameplate extends Entity {
  setup(params: {
    target: Entity;
    camera: CameraEntity;
    label: string;
    color: number;
  }): void {
    this.add(new Transform());
    this.add(
      new ScreenFollow({
        target: params.target,
        camera: params.camera,
        offset: new Vec2(0, -40), // 40 screen px above the target center
      }),
    );
    const panel = this.add(
      new UIPanel({
        positioning: "transform",
        anchor: Anchor.BottomCenter,
        padding: 4,
        background: { color: 0x000000, alpha: 0.6, radius: 4 },
      }),
    );
    panel.text(params.label, { fontSize: 11, fill: params.color });
  }
}

// ---------------------------------------------------------------------------
// Enemy health bar — same pattern, different offset + contents.
// ---------------------------------------------------------------------------
class EnemyHealthBar extends Entity {
  setup(params: { target: Entity; camera: CameraEntity }): void {
    this.add(new Transform());
    this.add(
      new ScreenFollow({
        target: params.target,
        camera: params.camera,
        offset: new Vec2(0, -22),
      }),
    );
    const panel = this.add(
      new UIPanel({
        positioning: "transform",
        anchor: Anchor.BottomCenter,
        padding: 1,
        background: { color: 0x000000, alpha: 0.5, radius: 2 },
      }),
    );
    const bar = new UIProgressBar({
      value: 1,
      width: 40,
      height: 5,
      trackBackground: { color: 0x3f3f3f, alpha: 1 },
      fillBackground: { color: 0x22c55e, alpha: 1 },
    });
    panel.addElement(bar);
    this.add(new HealthBarSync(bar, params.target));
  }
}

class HealthBarSync extends Component {
  private lastRatio = -1;

  constructor(
    private readonly bar: UIProgressBar,
    private readonly target: Entity,
  ) {
    super();
  }

  update(): void {
    const health = this.target.tryGet(Health);
    if (!health) return;
    if (health.ratio === this.lastRatio) return;
    this.lastRatio = health.ratio;
    this.bar.update({ value: health.ratio });
  }
}

// ---------------------------------------------------------------------------
// Enemy — logical root (Transform + state, no visual of its own). The body,
// nameplate, and HP bar are all siblings parented under this entity so
// cascade-destroy cleans them up when the enemy dies.
// ---------------------------------------------------------------------------
class Enemy extends Entity {
  setup(params: {
    x: number;
    y: number;
    label: string;
    color: number;
    camera: CameraEntity;
  }): void {
    this.add(new Transform({ position: new Vec2(params.x, params.y) }));
    this.add(new Health({ max: 100 }));
    this.spawnChild("body", EnemyBody, { color: params.color });
    this.spawnChild("nameplate", EnemyNameplate, {
      target: this,
      camera: params.camera,
      label: params.label,
      color: params.color,
    });
    this.spawnChild("hp", EnemyHealthBar, {
      target: this,
      camera: params.camera,
    });
  }
}

// ---------------------------------------------------------------------------
// Player controller — WASD, Q/E zoom, R rotate, click to damage
// ---------------------------------------------------------------------------
class PlayerController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);
  private readonly camera: CameraEntity;
  private disposeClickListener: (() => void) | null = null;

  constructor(camera: CameraEntity) {
    super();
    this.camera = camera;
  }

  onAdd(): void {
    this.camera.follow(this.transform, {
      smoothing: 0.2,
      deadzone: { halfWidth: 40, halfHeight: 30 },
    });
    this.camera.bounds = { minX: 0, minY: 0, maxX: WORLD, maxY: WORLD };
    // InputManager.onPointerDown delivers `screenPos` already routed through
    // the renderer's `canvasToVirtual` — so it stays accurate under any fit
    // mode / aspect ratio mismatch. Hand-rolling `clientX/rect.width*WIDTH`
    // (the previous version) silently drifts whenever the canvas CSS aspect
    // doesn't match the declared virtual aspect.
    this.input.setCamera(this.camera);
    this.disposeClickListener = this.input.onPointerDown((p) => {
      if (!p.buttons.has(0)) return;
      const world = this.camera.screenToWorld(p.screenPos.x, p.screenPos.y);
      this.handleClick(world);
    });
  }

  onDestroy(): void {
    this.disposeClickListener?.();
    this.disposeClickListener = null;
  }

  update(dt: number): void {
    const dir = this.input.getVector("left", "right", "up", "down");
    if (dir.x !== 0 || dir.y !== 0) {
      const move = dir.normalize().scale(0.3 * dt);
      this.transform.translate(move.x, move.y);
    }

    if (this.input.isJustPressed("zoomIn")) {
      this.camera.zoomTo(Math.min(this.camera.zoom + 0.3, 2.5), 300);
    }
    if (this.input.isJustPressed("zoomOut")) {
      this.camera.zoomTo(Math.max(this.camera.zoom - 0.3, 0.6), 300);
    }
    if (this.input.isJustPressed("zoomReset")) {
      this.camera.zoomTo(1, 300);
    }
    if (this.input.isJustPressed("rotate")) {
      this.camera.rotation = this.camera.rotation + Math.PI / 8;
    }
    if (this.input.isJustPressed("rotateReset")) {
      this.camera.rotation = 0;
    }
  }

  private handleClick(world: Vec2): void {
    let closest: Entity | undefined;
    let closestDist = Infinity;
    for (const e of this.scene.findEntitiesByTag("enemy")) {
      const t = e.tryGet(Transform);
      if (!t) continue;
      const dist = t.worldPosition.sub(world).length();
      if (dist < closestDist) {
        closestDist = dist;
        closest = e;
      }
    }
    if (closest && closestDist < 40) {
      closest.get(Health).damage(20);
    }
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class DemoScene extends Scene {
  readonly name = "world-ui";

  readonly layers: readonly LayerDef[] = [
    { name: "bg", order: -10 },
    { name: "world", order: 0 },
    // The "ui" layer is auto-provisioned screen-space by @yagejs/ui on
    // first use — our nameplate + health bar entities land there.
  ];

  constructor() {
    super();
  }

  onEnter(): void {
    const cam = this.spawn(CameraEntity, {
      position: new Vec2(WORLD / 2, WORLD / 2),
    });

    this.drawGrid();

    const enemies: Array<{
      x: number;
      y: number;
      label: string;
      color: number;
    }> = [
      { x: 600, y: 600, label: "Grunt", color: 0xff6b6b },
      { x: 1400, y: 700, label: "Scout", color: 0x4ecdc4 },
      { x: 800, y: 1300, label: "Brute", color: 0xffe66d },
      { x: 1300, y: 1400, label: "Archer", color: 0xa78bfa },
      { x: 1000, y: 400, label: "Mage", color: 0xf97316 },
    ];
    for (const spec of enemies) {
      const e = this.spawn(Enemy, { ...spec, camera: cam });
      e.tags.add("enemy");
    }

    const player = this.spawn("player");
    player.add(new Transform({ position: new Vec2(WORLD / 2, WORLD / 2) }));
    player.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.circle(0, 0, 12).fill({ color: 0x38bdf8 });
        g.circle(0, 0, 12).stroke({ color: 0xffffff, width: 2 });
        g.circle(0, 0, 3).fill({ color: 0xffffff });
      }),
    );
    player.add(new PlayerController(cam));
  }

  private drawGrid(): void {
    const grid = this.spawn("grid");
    grid.add(new Transform());
    grid.add(
      new GraphicsComponent({ layer: "bg" }).draw((g) => {
        g.rect(0, 0, WORLD, WORLD).fill({ color: 0x0f172a, alpha: 1 });
        for (let x = 0; x <= WORLD; x += 200) {
          g.moveTo(x, 0).lineTo(x, WORLD).stroke({ color: 0x1e293b, width: 1 });
        }
        for (let y = 0; y <= WORLD; y += 200) {
          g.moveTo(0, y).lineTo(WORLD, y).stroke({ color: 0x1e293b, width: 1 });
        }
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const engine = new Engine({ debug: true });
const container = getContainer();

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
      up: ["KeyW", "ArrowUp"],
      down: ["KeyS", "ArrowDown"],
      left: ["KeyA", "ArrowLeft"],
      right: ["KeyD", "ArrowRight"],
      zoomIn: ["KeyQ"],
      zoomOut: ["KeyE"],
      zoomReset: ["Digit0"],
      rotate: ["KeyR"],
      rotateReset: ["KeyT"],
    },
  }),
);
engine.use(new UIPlugin());
engine.use(new DebugPlugin());

await engine.start();

await engine.scenes.push(new DemoScene());
