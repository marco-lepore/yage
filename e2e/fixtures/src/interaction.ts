/**
 * Deterministic e2e fixture for @yagejs-addons/interaction.
 *
 * A player `Interactor` (range 80px) with two straight-line targets from a
 * fixed start position: a coin 160px below (focus + interact + walk-away),
 * and an overlapping crate/chest pair 160px above (priority tie-break). The
 * clock is frozen at boot; the spec drives movement through the REAL
 * `InputManager` (`inspector.input.hold`/`fireAction`) to exercise the
 * addon's own auto-input wiring, not just the headless model.
 */

import { Component, Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import { RendererPlugin, CameraEntity, GraphicsComponent } from "@yagejs/renderer";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import { Interactable, Interactor, InteractionFocusChangedEvent } from "@yagejs-addons/interaction";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();

const WIDTH = 800;
const HEIGHT = 600;
const PLAYER_SPEED = 180;
const container = setupContainer(WIDTH, HEIGHT);

interface FixtureState {
  coinsCollected: number;
  lastPrompt: string | null;
}

/** Plain WASD movement — no bounds clamping needed, the fixture's targets
 *  sit well inside the 800×600 play area. */
class PlayerMover extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);

  update(dt: number): void {
    const dx = this.input.getAxis("move-left", "move-right");
    const dy = this.input.getAxis("move-up", "move-down");
    if (dx === 0 && dy === 0) return;
    const len = Math.hypot(dx, dy) || 1;
    const step = PLAYER_SPEED * dt;
    const p = this.transform.position;
    this.transform.setPosition(p.x + (dx / len) * step, p.y + (dy / len) * step);
  }
}

class InteractionScene extends Scene {
  readonly name = "interaction-e2e";

  onEnter(): void {
    const state: FixtureState = { coinsCollected: 0, lastPrompt: null };

    this.spawn(CameraEntity, { position: new Vec2(WIDTH / 2, HEIGHT / 2) });

    const player = this.spawn("player");
    player.add(new Transform({ position: new Vec2(400, 300) }));
    player.add(new GraphicsComponent().draw((g) => g.circle(0, 0, 12).fill({ color: 0x38bdf8 })));
    player.add(new PlayerMover());
    const interactor = player.add(new Interactor({ range: 80 }));
    player.on(InteractionFocusChangedEvent, ({ prompt }) => {
      state.lastPrompt = prompt;
    });

    const coin = this.spawn("coin");
    coin.add(new Transform({ position: new Vec2(400, 460) })); // 160px below start
    coin.add(new GraphicsComponent().draw((g) => g.circle(0, 0, 8).fill({ color: 0xfacc15 })));
    const coinInteractable = coin.add(
      new Interactable({
        prompt: "Pick up",
        onInteract: () => {
          state.coinsCollected++;
          coin.destroy();
        },
      }),
    );

    // Same position, different priority — the chest must always win.
    const crate = this.spawn("crate");
    crate.add(new Transform({ position: new Vec2(400, 140) })); // 160px above start
    crate.add(new GraphicsComponent().draw((g) => g.circle(0, 0, 8).fill({ color: 0x94a3b8 })));
    const crateInteractable = crate.add(
      new Interactable({ prompt: "Search crate", onInteract: () => {} }),
    );
    const chest = this.spawn("chest");
    chest.add(new Transform({ position: new Vec2(400, 140) }));
    chest.add(new GraphicsComponent().draw((g) => g.circle(0, 0, 8).fill({ color: 0xf59e0b })));
    const chestInteractable = chest.add(
      new Interactable({ prompt: "Open quest chest", priority: 10, onInteract: () => {} }),
    );

    (window as unknown as { __interaction__: unknown }).__interaction__ = {
      interactor,
      state,
      coinInteractable,
      crateInteractable,
      chestInteractable,
    };
  }
}

const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0a0a0a,
    resolution: 1,
    container,
  }),
);
engine.use(
  new InputPlugin({
    actions: {
      interact: ["KeyE"],
      "move-up": ["KeyW"],
      "move-down": ["KeyS"],
      "move-left": ["KeyA"],
      "move-right": ["KeyD"],
    },
  }),
);
engine.use(new DebugPlugin());
await engine.start();
engine.inspector.time.freeze();
await engine.scenes.push(new InteractionScene());
