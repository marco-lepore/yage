import {
  Component,
  Engine,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import {
  GraphicsComponent,
  RendererPlugin,
  TextComponent,
} from "@yagejs/renderer";
import {
  InputManagerKey,
  InputPlugin,
  getKeyDisplayName,
} from "@yagejs/input";
import { injectStyles, setupGameContainer } from "./shared.js";

injectStyles();

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const WIDTH = 800;
const HEIGHT = 600;
const SHIP_SPEED = 220; // px/s at full stick deflection
const ROTATE_SNAP = 4 * Math.PI; // rad/s — how fast the ship rotates toward the right-stick aim

// ---------------------------------------------------------------------------
// Ship — moves with the left stick, rotates toward the right stick.
// Falls back to WASD + mouse when no controller is connected.
// ---------------------------------------------------------------------------

class ShipController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);
  private readonly graphics = this.sibling(GraphicsComponent);
  private boosting = false;

  update(dt: number): void {
    const seconds = dt / 1000;

    // -- Movement: left stick OR WASD --
    let move = this.input.getStick("left");
    if (move.x === 0 && move.y === 0) {
      move = this.input.getVector("kbLeft", "kbRight", "kbUp", "kbDown");
      if (move.lengthSq() > 1) move = move.normalize();
    }
    this.transform.translate(move.x * SHIP_SPEED * seconds, move.y * SHIP_SPEED * seconds);

    // Keep ship in bounds
    const pos = this.transform.position;
    const clampedX = Math.max(20, Math.min(WIDTH - 20, pos.x));
    const clampedY = Math.max(20, Math.min(HEIGHT - 20, pos.y));
    if (clampedX !== pos.x || clampedY !== pos.y) {
      this.transform.setPosition(clampedX, clampedY);
    }

    // -- Aim: right stick OR mouse direction (when stick idle) --
    const aim = this.input.getStick("right");
    if (aim.x !== 0 || aim.y !== 0) {
      const target = Math.atan2(aim.y, aim.x);
      this.transform.rotation = stepTowardAngle(
        this.transform.rotation,
        target,
        ROTATE_SNAP * seconds,
      );
    }

    // -- Boost: A button or Space, intensity also reflects right trigger --
    const trigger = this.input.getTrigger("right");
    const boostPressed = this.input.isPressed("boost") || trigger > 0.05;
    if (boostPressed !== this.boosting) {
      this.boosting = boostPressed;
      this.redraw();
    }
  }

  redraw(): void {
    this.graphics.draw((g) => {
      // GraphicsComponent.draw() appends; clear before each repaint or
      // shapes accumulate every time the boost state toggles.
      g.clear();
      if (this.boosting) {
        g.circle(-22, 0, 14).fill({ color: 0xfacc15, alpha: 0.55 });
        g.circle(-22, 0, 18).fill({ color: 0xf97316, alpha: 0.25 });
      }
      // Ship body — pointing along +X
      g.poly([22, 0, -16, -14, -10, 0, -16, 14]).fill({ color: 0x60a5fa });
      g.poly([22, 0, -16, -14, -10, 0, -16, 14]).stroke({
        color: 0x1e3a8a,
        width: 2,
      });
      // Cockpit dot
      g.circle(6, 0, 3).fill({ color: 0xfef3c7 });
    });
  }
}

function stepTowardAngle(current: number, target: number, maxStep: number): number {
  const TAU = Math.PI * 2;
  let delta = ((target - current) % TAU + TAU) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (Math.abs(delta) < maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}

// ---------------------------------------------------------------------------
// HUD — visualizes stick / trigger / button state and active-pad info.
// Lives on the same entity as a GraphicsComponent (for shapes) plus
// TextComponents (for labels). Redraws each frame.
// ---------------------------------------------------------------------------

class GamepadHud extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly graphics = this.sibling(GraphicsComponent);
  private readonly headerText: TextComponent;
  private readonly buttonsText: TextComponent;

  constructor(headerText: TextComponent, buttonsText: TextComponent) {
    super();
    this.headerText = headerText;
    this.buttonsText = buttonsText;
  }

  update(): void {
    // -- Header --
    const active = this.input.getActivePad();
    const all = this.input.gamepads();
    if (active) {
      this.headerText.setText(
        `Active pad: ${active.id}    (${all.length} connected)`,
      );
    } else if (all.length > 0) {
      this.headerText.setText(
        `${all.length} pad(s) connected — press any button to activate`,
      );
    } else {
      this.headerText.setText(
        "Plug in a controller and press any button. Keyboard fallback: WASD to move.",
      );
    }

    // -- Held gamepad buttons --
    const held = this.input
      .snapshotState()
      .gamepad.buttons.map(getKeyDisplayName);
    this.buttonsText.setText(held.length > 0 ? held.join(" · ") : "—");

    // -- Stick + trigger visualization --
    const left = this.input.getStick("left");
    const right = this.input.getStick("right");
    const lt = this.input.getTrigger("left");
    const rt = this.input.getTrigger("right");
    this.drawHud(left, right, lt, rt);
  }

  private drawHud(left: Vec2, right: Vec2, lt: number, rt: number): void {
    this.graphics.draw((g) => {
      g.clear();
      const stickRadius = 28;
      // Left/right stick rings + dots
      drawStick(g, 60, 60, stickRadius, left);
      drawStick(g, 200, 60, stickRadius, right);
      // Trigger bars
      drawTriggerBar(g, 320, 32, lt);
      drawTriggerBar(g, 360, 32, rt);
    });
  }
}

function drawStick(
  g: import("pixi.js").Graphics,
  cx: number,
  cy: number,
  radius: number,
  value: Vec2,
): void {
  g.circle(cx, cy, radius).stroke({ color: 0x475569, width: 1.5 });
  g.moveTo(cx - radius, cy).lineTo(cx + radius, cy).stroke({
    color: 0x334155,
    width: 1,
  });
  g.moveTo(cx, cy - radius).lineTo(cx, cy + radius).stroke({
    color: 0x334155,
    width: 1,
  });
  const isActive = value.lengthSq() > 0;
  g.circle(cx + value.x * radius, cy + value.y * radius, 5).fill({
    color: isActive ? 0x22d3ee : 0x64748b,
  });
}

function drawTriggerBar(
  g: import("pixi.js").Graphics,
  x: number,
  yTop: number,
  value: number,
): void {
  const height = 56;
  const width = 14;
  g.rect(x, yTop, width, height).stroke({ color: 0x475569, width: 1.5 });
  const filled = Math.min(1, Math.max(0, value)) * (height - 4);
  g.rect(x + 2, yTop + height - 2 - filled, width - 4, filled).fill({
    color: value > 0.05 ? 0x22d3ee : 0x334155,
  });
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

class GamepadScene extends Scene {
  readonly name = "gamepad";

  onEnter(): void {
    // Ship
    const ship = this.spawn("ship");
    ship.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }));
    ship.add(new GraphicsComponent());
    const controller = ship.add(new ShipController());
    controller.redraw(); // paint the initial ship before its first update

    // Header text — anchored top-left of viewport
    const headerEntity = this.spawn("header");
    headerEntity.add(new Transform({ position: new Vec2(20, 20) }));
    const headerText = headerEntity.add(
      new TextComponent({
        text: "",
        style: { fontFamily: "system-ui, sans-serif", fontSize: 14, fill: 0xe2e8f0 },
      }),
    );

    // HUD strip — anchored bottom-left
    const hudEntity = this.spawn("hud");
    hudEntity.add(new Transform({ position: new Vec2(20, HEIGHT - 130) }));
    hudEntity.add(new GraphicsComponent());

    // Stick / trigger labels
    addHudLabel(this, 60 + 20, HEIGHT - 130 + 100, "L Stick");
    addHudLabel(this, 200 + 20, HEIGHT - 130 + 100, "R Stick");
    addHudLabel(this, 320 + 20, HEIGHT - 130 + 100, "LT");
    addHudLabel(this, 360 + 20, HEIGHT - 130 + 100, "RT");

    // Held-buttons text — anchored bottom-right of HUD strip
    const buttonsEntity = this.spawn("buttons");
    buttonsEntity.add(
      new Transform({ position: new Vec2(450, HEIGHT - 95) }),
    );
    const buttonsLabel = this.spawn("buttons-label");
    buttonsLabel.add(new Transform({ position: new Vec2(450, HEIGHT - 115) }));
    buttonsLabel.add(
      new TextComponent({
        text: "Buttons held",
        style: { fontFamily: "system-ui, sans-serif", fontSize: 11, fill: 0x94a3b8 },
      }),
    );
    const buttonsText = buttonsEntity.add(
      new TextComponent({
        text: "—",
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 14,
          fill: 0xe2e8f0,
        },
      }),
    );

    hudEntity.add(new GamepadHud(headerText, buttonsText));

    // Footer — controls hint
    const footer = this.spawn("footer");
    footer.add(new Transform({ position: new Vec2(20, HEIGHT - 48) }));
    footer.add(
      new TextComponent({
        text: "Left stick / WASD: move    ·    Right stick: aim    ·    A or Space or RT: boost",
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 12,
          fill: 0x64748b,
        },
      }),
    );
  }
}

function addHudLabel(scene: Scene, x: number, y: number, text: string): void {
  const entity = scene.spawn("hud-label");
  entity.add(new Transform({ position: new Vec2(x, y) }));
  entity.add(
    new TextComponent({
      text,
      anchor: { x: 0.5, y: 0 },
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 11,
        fill: 0x94a3b8,
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  const engine = new Engine();

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
        // Keyboard fallback so the example is playable without a controller.
        kbUp: ["KeyW", "ArrowUp"],
        kbDown: ["KeyS", "ArrowDown"],
        kbLeft: ["KeyA", "ArrowLeft"],
        kbRight: ["KeyD", "ArrowRight"],
        // Boost works from keyboard, mouse, or gamepad.
        boost: ["Space", "MouseLeft", "GamepadA"],
      },
      preventDefaultKeys: ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    }),
  );

  await engine.start();
  await engine.scenes.push(new GamepadScene());
}

main().catch(console.error);
