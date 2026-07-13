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
  TextComponent,
} from "@yagejs/renderer";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import {
  prefersTouchControls,
  VirtualButtonPressEvent,
  VirtualControls,
} from "@yagejs-addons/virtual-controls";
import { createControlsPresenter } from "@yagejs-addons/virtual-controls/presenters";
import { injectStyles, installDebugFromUrl, setupGameContainer } from "./shared.js";

injectStyles(`
  /* Keep the browser from turning touches into scroll/zoom/selection. */
  #game-container { touch-action: none; user-select: none; -webkit-user-select: none; }
  #layout-buttons button {
    margin-left: 0.4rem;
    padding: 0.3rem 0.7rem;
    background: #1e293b;
    color: #e2e8f0;
    border: 1px solid #334155;
    border-radius: 6px;
    cursor: pointer;
  }
  #layout-buttons button:hover { border-color: #38bdf8; }
`);

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

/**
 * A side-view runner square driven ONLY through the action map + getStick —
 * it has no idea whether a keyboard, a gamepad, or the virtual overlay is
 * feeding it. That's the addon's point: gameplay code stays input-agnostic.
 */
class Player extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);
  private readonly gfx = this.sibling(GraphicsComponent);
  private vy = 0;
  private grounded = true;
  private facing = 1;
  private dashLeft = 0;
  dashCooldown = 0;

  override onAdd(): void {
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
        if (this.dashCooldown <= 0) {
          this.dashLeft = DASH_TIME;
          this.dashCooldown = DASH_COOLDOWN;
        }
      }),
    );
  }

  override update(dt: number): void {
    // Analog when the virtual stick (or a real pad) deflects, else digital.
    const stickX = this.input.getStick("left").x;
    const moveX = stickX !== 0 ? stickX : this.input.getAxis("left", "right");
    if (moveX !== 0) this.facing = Math.sign(moveX);

    let vx = moveX * MOVE_SPEED;
    if (this.dashLeft > 0) {
      this.dashLeft -= dt;
      vx = this.facing * DASH_SPEED;
    }
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);

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
      .fill({ color: this.dashLeft > 0 ? 0xf472b6 : 0x38bdf8 })
      .roundRect(this.facing > 0 ? 4 : -10, -8, 6, 6, 2)
      .fill({ color: 0x0f172a });
  }
}

/**
 * Tap-to-ripple backdrop. Each pointer press is recorded, then judged on the
 * NEXT update — after the input drain has settled consumption — via
 * `isPointerConsumed`: touches the overlay claimed never ripple, everything
 * else does. That's the consumePointer guarantee, observable per pointer.
 */
class RippleBackdrop extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly gfx = this.sibling(GraphicsComponent);
  private readonly ripples: { pos: Vec2; t: number }[] = [];
  private pending = new Map<number, Vec2>();

  override onAdd(): void {
    this.addCleanup(
      this.input.onPointerDown((p) => {
        this.pending.set(p.id, p.screenPos);
      }),
    );
    // A fast tap can press AND release before the next frame's judgment —
    // and the consume mark clears when the release drains. Judge such taps
    // at the up listener, where the mark is still readable.
    this.addCleanup(
      this.input.onPointerUp((p) => this.judge(p.id)),
    );
  }

  /** Ripple once per press, only if no control consumed the pointer. */
  private judge(id: number): void {
    const pos = this.pending.get(id);
    if (!pos) return;
    this.pending.delete(id);
    if (!this.input.isPointerConsumed(id)) {
      this.ripples.push({ pos, t: 0 });
      if (this.ripples.length > 16) this.ripples.shift();
    }
  }

  override update(dt: number): void {
    for (const id of [...this.pending.keys()]) {
      this.judge(id);
    }

    const g = this.gfx.graphics;
    g.clear();
    // Ground line.
    g.rect(0, GROUND_Y, WIDTH, 2).fill({ color: 0x334155 });
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]!;
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
  lastEvent = "—";

  constructor(
    private readonly text: TextComponent,
    private readonly player: Player,
  ) {
    super();
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
        `jump held ${this.input.isPressed("jump") ? `${Math.round(hold)}ms` : "no"}   dash cd ${cd.toFixed(2)}s`,
        `last button event: ${this.lastEvent}`,
        `prefersTouchControls(): ${prefersTouchControls() ? "yes — would auto-show" : "no — auto would hide (forced on here)"}`,
      ].join("\n"),
    );
  }
}

class ControlsDemoScene extends Scene {
  readonly name = "virtual-controls-demo";
  private controlsHost: Entity | null = null;
  private controls: VirtualControls | null = null;
  private hud!: Hud;

  onEnter(): void {
    const backdrop = this.spawn("backdrop");
    backdrop.add(new Transform());
    backdrop.add(new GraphicsComponent());
    backdrop.add(new RippleBackdrop());

    const player = this.spawn("player");
    player.add(new Transform({ position: new Vec2(WIDTH / 2, GROUND_Y - 18) }));
    player.add(new GraphicsComponent());
    const playerComp = player.add(new Player());

    const hudEntity = this.spawn("hud");
    hudEntity.add(new Transform({ position: new Vec2(20, 16) }));
    const hudText = hudEntity.add(
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
    this.hud = hudEntity.add(new Hud(hudText, playerComp));

    this.buildControls(2);
  }

  /**
   * (Re)build the overlay with N buttons — 1, 2 and 4 all auto-arrange
   * around the bottom-right corner with no placement config. The control
   * set is construction-time, so reconfiguring = destroy + respawn; a
   * finger already down during the swap must lift and re-touch (a freshly
   * mounted overlay only sees new presses).
   */
  buildControls(buttonCount: 1 | 2 | 4): void {
    this.controlsHost?.destroy();

    const buttons = [
      { id: "a", label: "A", action: "jump" },
      { id: "b", label: "B", action: "dash" },
      // Event-only buttons: no action, observed via VirtualButtonPressEvent.
      { id: "x", label: "X" },
      { id: "y", label: "Y" },
    ].slice(0, buttonCount);

    const host = this.spawn("touch-controls");
    this.controls = host.add(
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
    host.on(VirtualButtonPressEvent, (e) => {
      this.hud.lastEvent = e.action
        ? `${e.id} → action "${e.action}"`
        : `${e.id} (event-only, no action)`;
    });
    this.controlsHost = host;
  }

  toggleControls(): void {
    if (this.controls) this.controls.setVisible(!this.controls.visible);
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
