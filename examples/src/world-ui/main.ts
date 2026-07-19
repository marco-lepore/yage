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
  SortGroupComponent,
  ySort,
} from "@yagejs/renderer";
import type { LayerDef } from "@yagejs/renderer";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import {
  Anchor,
  attachTooltip,
  UIPanel,
  UISurface,
  UIPlugin,
  UIProgressBar,
  UIText,
} from "@yagejs/ui";
import { getContainer, installDebugFromUrl } from "../shared/bootstrap.js";

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
    this.localTransform.setRotation(delta.angle() + Math.PI / 2);
  }
}

// ---------------------------------------------------------------------------
// Enemy crystal (child of Enemy): a gem offset toward the camera (+Y), so a
// raw ySort would paint it *in front* of the body — and any unrelated entity
// (the roaming player) whose Y lands between the two would slot *between* them,
// slicing the enemy in half. The SortGroupComponent on the Enemy binds the body
// and crystal into one stacking context, so the pair sorts as a single unit at
// the enemy's footing and the player always passes cleanly in front of or
// behind the whole enemy.
// ---------------------------------------------------------------------------
class EnemyCrystal extends Entity {
  setup(params: { color: number }): void {
    this.add(new Transform({ position: new Vec2(0, 26) }));
    this.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.poly([0, -7, 5, 0, 0, 7, -5, 0]).fill({ color: params.color });
        g.poly([0, -7, 5, 0, 0, 7, -5, 0]).stroke({
          color: 0xffffff,
          alpha: 0.9,
          width: 1,
        });
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Enemy nameplate — independent entity, sits above the enemy via ScreenFollow.
// ScreenFollow writes camera.worldToScreen(target + offset) to this entity's
// Transform each frame; UISurface with positioning: "transform" reads that
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
      new UISurface({
        positioning: "transform",
        anchor: Anchor.BottomCenter,
        padding: 4,
        background: { color: 0x000000, alpha: 0.6, radius: 4 },
      }),
    );
    panel.text(params.label, { fontSize: 11, fill: params.color });

    // Imperative tooltip on the namecard — a stats card that stays glued
    // above the trigger as the enemy traverses the screen (the overlay
    // re-anchors it every frame against the camera-transformed trigger).
    // `attachTooltip` works here with no `<UIRoot>` / React in sight.
    this.add(
      new NameplateTooltip(panel, {
        label: params.label,
        color: params.color,
        target: params.target,
      }),
    );
  }
}

// Builds + owns the namecard's stats tooltip. Holds the `dispose()` so the
// overlay slot + hover handler are released when the nameplate is destroyed
// (cascade-destroyed with the enemy).
class NameplateTooltip extends Component {
  private dispose: (() => void) | null = null;
  // Live HP line — kept so the card reflects damage instead of freezing the
  // values captured when `content()` ran. `content` is called once, so a
  // tooltip with dynamic data holds its own node references and mutates them.
  private hpText: UIText | null = null;
  private lastHp = -1;

  constructor(
    private readonly panel: UISurface,
    private readonly params: { label: string; color: number; target: Entity },
  ) {
    super();
  }

  onAdd(): void {
    const tip = attachTooltip(this.panel.root, this.scene, {
      placement: "top",
      offset: 8,
      maxWidth: 200,
      content: () => {
        const card = new UIPanel({
          padding: 6,
          gap: 4,
          background: { color: 0x111827, alpha: 0.95, radius: 6 },
        });
        card.addElement(
          new UIText({
            children: this.params.label,
            style: { fontSize: 13, fill: this.params.color, fontWeight: "bold" },
          }),
        );
        this.hpText = new UIText({
          children: this.hpLabel(),
          style: { fontSize: 11, fill: 0xe5e7eb },
        });
        card.addElement(this.hpText);
        card.addElement(
          new UIText({
            children: "A hostile unit. Click to deal damage.",
            style: { fontSize: 10, fill: 0x9ca3af },
          }),
        );
        return card;
      },
    });
    // attachTooltip wires no input of its own — drive it on hover here. This
    // owns the panel's `onHover`; compose (`(h) => { …; tip.setActive(h); }`)
    // if the namecard ever needs its own hover reaction too.
    this.panel.setPointerHandlers({ onHover: tip.setActive });
    this.dispose = tip.dispose;
  }

  // The damage CTA mutates Health each click; keep the card's HP line in sync
  // so the tooltip shows live values. Only touch the node when it changes.
  update(): void {
    const health = this.params.target.tryGet(Health);
    if (!this.hpText || !health || health.current === this.lastHp) return;
    this.lastHp = health.current;
    this.hpText.update({ children: this.hpLabel() });
  }

  private hpLabel(): string {
    const health = this.params.target.tryGet(Health);
    return health ? `HP ${health.current} / ${health.max}` : "HP ? / ?";
  }

  onDestroy(): void {
    this.dispose?.();
    this.dispose = null;
    this.hpText = null;
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
      new UISurface({
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
// cascade-destroy cleans them up when the enemy dies. The SortGroupComponent
// gathers this entity's "world"-layer visuals (body + crystal) into one
// stacking context; the group sorts as a unit at the root's footing (the
// nameplate / HP bar live on the screen-space "ui" layer, so they're left out).
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
    // Add the group before the visuals it should capture.
    this.add(new SortGroupComponent({ layer: "world" }));
    this.spawnChild("body", EnemyBody, { color: params.color });
    this.spawnChild("crystal", EnemyCrystal, { color: params.color });
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
      // `p.button`, not `p.buttons`: down listeners fire before the press is
      // drained into `buttons`, so `buttons` is empty for a fresh click.
      if (p.button !== 0) return;
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
      const move = dir.normalize().scale(300 * dt);
      this.transform.translate(move.x, move.y);
    }

    if (this.input.isJustPressed("zoomIn")) {
      this.camera.zoomTo(Math.min(this.camera.zoom + 0.3, 2.5), 0.3);
    }
    if (this.input.isJustPressed("zoomOut")) {
      this.camera.zoomTo(Math.max(this.camera.zoom - 0.3, 0.6), 0.3);
    }
    if (this.input.isJustPressed("zoomReset")) {
      this.camera.zoomTo(1, 0.3);
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
    // Top-down view: ySort means a Mage standing south of the Grunt
    // correctly paints over them when their sprites overlap. Each enemy's
    // body + crystal stay welded together via a SortGroupComponent, so the
    // roaming player never slices between an enemy's parts.
    { name: "world", order: 0, sort: ySort },
    // The "ui" layer is auto-provisioned screen-space by @yagejs/ui on
    // first use — our nameplate + health bar entities land there.
  ];

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
await installDebugFromUrl(engine);

await engine.start();

await engine.scenes.push(new DemoScene());
