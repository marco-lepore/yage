import {
  Component,
  Engine,
  Entity,
  ProcessComponent,
  Scene,
  Transform,
  Vec2,
  type ProcessSlot,
} from "@yagejs/core";
import {
  GraphicsComponent,
  RendererPlugin,
  TextComponent,
} from "@yagejs/renderer";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import {
  prefersTouchControls,
  VirtualButtonPressEvent,
  VirtualControls,
} from "@yagejs-addons/virtual-controls";
import { createControlsPresenter } from "@yagejs-addons/virtual-controls/presenters";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";
import "./styles.css";

const WIDTH = 800;
const HEIGHT = 600;
const GROUND_Y = 520;

const MOVE_SPEED = 280; // px/s at full deflection
const JUMP_VELOCITY = 560; // px/s
const GRAVITY = 1500; // px/s²
const SHORT_HOP_GRAVITY_SCALE = 2.4; // extra gravity once jump is released
const DASH_SPEED = 900; // px/s
const DASH_TIME = 0.14; // s
const DASH_COOLDOWN = 0.8; // s

/** Spawn key of the overlay entity, for `scene.findByKey`. */
const CONTROLS_KEY = "touch-controls";

/**
 * A side-view runner square driven ONLY through the action map + getStick —
 * it has no idea whether a keyboard, a gamepad, or the virtual overlay is
 * feeding it. That's the addon's point: gameplay code stays input-agnostic.
 */
class PlayerController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);
  private readonly gfx = this.sibling(GraphicsComponent);
  private readonly processes = this.sibling(ProcessComponent);
  private vy = 0;
  private grounded = true;
  private facing = 1;
  /** Running while a dash moves the player. */
  private dash!: ProcessSlot;
  /** Running until the next dash is allowed. */
  private cooldown!: ProcessSlot;

  /** Seconds until the next dash is allowed; 0 when it is ready. */
  get dashCooldown(): number {
    if (!this.cooldown.running) return 0;
    return Math.max(0, DASH_COOLDOWN - this.cooldown.elapsed);
  }

  override onAdd(): void {
    this.dash = this.processes.slot({ duration: DASH_TIME });
    this.cooldown = this.processes.slot({ duration: DASH_COOLDOWN });

    this.addCleanup(
      this.input.onAction("jump", () => {
        if (this.grounded) {
          this.vy = -JUMP_VELOCITY;
          this.grounded = false;
        }
      }),
    );
    this.addCleanup(
      this.input.onAction("dash", () => {
        if (this.cooldown.running) return;
        this.dash.restart();
        this.cooldown.restart();
      }),
    );
  }

  override update(dt: number): void {
    // Analog when the virtual stick (or a real pad) deflects, else digital.
    const stickX = this.input.getStick("left").x;
    const moveX = stickX !== 0 ? stickX : this.input.getAxis("left", "right");
    if (moveX !== 0) this.facing = Math.sign(moveX);

    const vx = this.dash.running
      ? this.facing * DASH_SPEED
      : moveX * MOVE_SPEED;

    // Variable jump height: releasing the (held) jump action mid-rise pulls
    // the arc short — synthetic holds from the overlay behave exactly like a
    // held Space key here.
    const gravity =
      this.vy < 0 && !this.input.isPressed("jump")
        ? GRAVITY * SHORT_HOP_GRAVITY_SCALE
        : GRAVITY;
    this.vy += gravity * dt;

    const pos = this.transform.position;
    let x = pos.x + vx * dt;
    let y = pos.y + this.vy * dt;
    x = Math.min(Math.max(x, 24), WIDTH - 24);
    if (y >= GROUND_Y - 18) {
      y = GROUND_Y - 18;
      this.vy = 0;
      this.grounded = true;
    }
    this.transform.setPosition(x, y);

    this.gfx.graphics
      .clear()
      .roundRect(-18, -18, 36, 36, 6)
      .fill({ color: this.dash.running ? 0xf472b6 : 0x38bdf8 })
      .roundRect(this.facing > 0 ? 4 : -10, -8, 6, 6, 2)
      .fill({ color: 0x0f172a });
  }
}

/**
 * Tap-to-ripple backdrop. The frame query excludes presses claimed by the
 * touch controls or UI.
 */
class RippleBackdrop extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly gfx = this.sibling(GraphicsComponent);
  private readonly ripples: { pos: Vec2; t: number }[] = [];

  override update(dt: number): void {
    for (const press of this.input.getPointerPresses({ button: 0 })) {
      this.ripples.push({ pos: press.screenPos, t: 0 });
      if (this.ripples.length > 16) this.ripples.shift();
    }

    const g = this.gfx.graphics;
    g.clear();
    // Ground line.
    g.rect(0, GROUND_Y, WIDTH, 2).fill({ color: 0x334155 });
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      if (!r) continue;
      r.t += dt;
      if (r.t > 0.6) {
        this.ripples.splice(i, 1);
        continue;
      }
      const p = r.t / 0.6;
      g.circle(r.pos.x, r.pos.y, 8 + p * 46).stroke({
        width: 2,
        color: 0x38bdf8,
        alpha: 0.7 * (1 - p),
      });
    }
  }
}

/** Live readout of everything the overlay feeds into the input system. */
class Hud extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly text = this.sibling(TextComponent);
  private readonly player: PlayerController;
  private lastEvent = "—";

  constructor(player: PlayerController) {
    super();
    this.player = player;
  }

  override onAdd(): void {
    // The overlay emits on its own entity; the event bubbles to the scene, so
    // this keeps working when the overlay is rebuilt with another layout.
    this.listenScene(VirtualButtonPressEvent, (e) => {
      this.lastEvent = e.action
        ? `${e.id} → action "${e.action}"`
        : `${e.id} (event-only, no action)`;
    });
  }

  override update(): void {
    const stick = this.input.getStick("left");
    const vec = this.input.getVector("left", "right", "up", "down");
    const hold = this.input.getHoldDuration("jump");
    const cd = this.player.dashCooldown;
    this.text.setText(
      [
        `getStick("left")  x ${stick.x.toFixed(2)}  y ${stick.y.toFixed(2)}`,
        `getVector(4-way)  x ${vec.x.toFixed(0)}  y ${vec.y.toFixed(0)}`,
        `jump held ${this.input.isPressed("jump") ? `${hold.toFixed(2)}s` : "no"}   dash cd ${cd.toFixed(2)}s`,
        `last button event: ${this.lastEvent}`,
        `prefersTouchControls(): ${prefersTouchControls() ? "yes — would auto-show" : "no — auto would hide (forced on here)"}`,
      ].join("\n"),
    );
  }
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

class BackdropEntity extends Entity {
  setup(): void {
    this.add(new Transform());
    this.add(new GraphicsComponent());
    this.add(new RippleBackdrop());
  }
}

class PlayerEntity extends Entity {
  controller!: PlayerController;

  setup(): void {
    this.add(new Transform({ position: new Vec2(WIDTH / 2, GROUND_Y - 18) }));
    this.add(new GraphicsComponent());
    this.add(new ProcessComponent());
    this.controller = this.add(new PlayerController());
  }
}

class HudEntity extends Entity {
  setup(params: { player: PlayerController }): void {
    this.add(new Transform({ position: new Vec2(20, 16) }));
    this.add(
      new TextComponent({
        text: "",
        style: {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13,
          fill: 0x94a3b8,
          lineHeight: 19,
        },
      }),
    );
    this.add(new Hud(params.player));
  }
}

/**
 * The overlay with N buttons — 1, 2 and 4 all auto-arrange around the
 * bottom-right corner with no placement config.
 */
class TouchControls extends Entity {
  setup(params: { buttonCount: 1 | 2 | 4 }): void {
    const buttons = [
      { id: "a", label: "A", action: "jump" },
      { id: "b", label: "B", action: "dash" },
      // Event-only buttons: no action, observed via VirtualButtonPressEvent.
      { id: "x", label: "X" },
      { id: "y", label: "Y" },
    ].slice(0, params.buttonCount);

    this.add(
      new VirtualControls({
        // Forced on for this demo page; the default is "auto" (mobile only).
        visible: true,
        // Tuple shorthand: left/right/up/down order.
        stick: { actions: ["left", "right", "up", "down"] },
        buttons,
        presenter: createControlsPresenter({
          stickKnobColor: 0x38bdf8,
          buttonPressedColor: 0xf472b6,
        }),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

class ControlsDemoScene extends Scene {
  readonly name = "virtual-controls-demo";

  onEnter(): void {
    this.spawn(BackdropEntity);
    const player = this.spawn(PlayerEntity);
    this.spawn(HudEntity, { player: player.controller });
    this.buildControls(2);
  }

  /**
   * (Re)build the overlay for the page's layout buttons. The control set is
   * construction-time, so reconfiguring = destroy + respawn; a finger already
   * down during the swap must lift and re-touch (a freshly mounted overlay
   * only sees new presses).
   */
  buildControls(buttonCount: 1 | 2 | 4): void {
    this.findByKey(CONTROLS_KEY)?.destroy();
    this.spawn(TouchControls, { buttonCount }, { key: CONTROLS_KEY });
  }

  toggleControls(): void {
    const controls = this.findByKey(CONTROLS_KEY)?.get(VirtualControls);
    controls?.setVisible(!controls.visible);
  }
}

async function main() {
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
        left: ["KeyA", "ArrowLeft"],
        right: ["KeyD", "ArrowRight"],
        up: ["KeyW", "ArrowUp"],
        down: ["KeyS", "ArrowDown"],
        jump: ["Space"],
        dash: ["ShiftLeft"],
      },
      preventDefaultKeys: ["Space", "ArrowUp", "ArrowDown"],
    }),
  );

  await installDebugFromUrl(engine);

  await engine.start();
  const scene = new ControlsDemoScene();
  await engine.scenes.push(scene);

  for (const btn of document.querySelectorAll<HTMLButtonElement>(
    "#layout-buttons button[data-count]",
  )) {
    btn.addEventListener("click", () => {
      scene.buildControls(Number(btn.dataset.count) as 1 | 2 | 4);
    });
  }
  document
    .getElementById("toggle-visible")
    ?.addEventListener("click", () => scene.toggleControls());
}

main().catch(console.error);
