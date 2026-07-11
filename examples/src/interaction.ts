/**
 * Interaction addon example — the composition demo `@yagejs-addons/interaction`
 * exists for: one player `Interactor` meeting three different addons/patterns
 * through the SAME `Interactable` marking, with zero addon-to-addon coupling:
 *
 *  • **An NPC** ("Talk") — stands in for a dialogue addon call
 *    (`onInteract: () => dialogue.play(script)` in a real game).
 *  • **A coin pickup** ("Pick up") — stands in for an inventory addon call;
 *    destroys itself and bumps a HUD counter on interact.
 *  • **A door** (live "Open"/"Close" prompt) — toggles, proving the `prompt`
 *    provider re-resolves every frame with no re-wiring.
 *  • **An overlapping pair** (quest chest vs. decorative crate, same
 *    position) — the quest chest's higher `priority` always wins the focus
 *    tie, so the crate is never reachable underneath it.
 *
 * The addon is headless: this example owns 100% of the rendering. The prompt
 * label is the ENTIRE render step — one `InteractionFocusChangedEvent`
 * listener, since the event fires only on a real transition.
 *
 * Controls: WASD/arrows walk · E interact.
 */

import { Component, Engine, type Entity, MathUtils, Scene, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent, RendererPlugin, TextComponent } from "@yagejs/renderer";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import { Interactable, Interactor, InteractionFocusChangedEvent } from "@yagejs-addons/interaction";
import { injectStyles, setupGameContainer } from "./shared.js";

injectStyles();

const WIDTH = 800;
const HEIGHT = 600;
const PLAYER_SPEED = 180;
const BOUNDS = { minX: 40, maxX: WIDTH - 40, minY: 100, maxY: HEIGHT - 40 };

// ── demo state (the "consequence" side of rules-in/consequences-out) ────────

interface DemoState {
  npcTalks: number;
  coinsCollected: number;
  doorOpen: boolean;
}

// ── player movement (plain WASD, no physics) ─────────────────────────────────

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
    this.transform.setPosition(
      MathUtils.clamp(p.x + (dx / len) * step, BOUNDS.minX, BOUNDS.maxX),
      MathUtils.clamp(p.y + (dy / len) * step, BOUNDS.minY, BOUNDS.maxY),
    );
  }
}

// ── scene ─────────────────────────────────────────────────────────────────────

class InteractionRoomScene extends Scene {
  readonly name = "interaction-room";

  onEnter(): void {
    const state: DemoState = { npcTalks: 0, coinsCollected: 0, doorOpen: false };

    this.drawRoom();

    const player = this.spawn("player");
    player.add(new Transform({ position: new Vec2(400, 300) }));
    player.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 16).fill({ color: 0x38bdf8 });
        g.circle(0, 0, 16).stroke({ color: 0x0ea5e9, width: 2 });
      }),
    );
    player.add(new PlayerMover());
    const interactor = player.add(new Interactor({ range: 60 }));

    // The ENTIRE render step for the addon's output: one label, one listener.
    const prompt = this.spawn("prompt");
    prompt.add(new Transform({ position: new Vec2(400, 270) }));
    const promptText = prompt.add(
      new TextComponent({
        text: "",
        style: { fontSize: 14, fill: 0xffffff, fontFamily: "sans-serif" },
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
    promptText.text.visible = false;
    player.on(InteractionFocusChangedEvent, ({ prompt: text }) => {
      promptText.text.text = text ?? "";
      promptText.text.visible = text !== null;
    });

    // ── NPC: stands in for a dialogue addon call ───────────────────────────
    const npc = this.spawnMarker("npc", 400, 150, 0xf97316);
    npc.add(
      new Interactable({
        prompt: "Talk",
        onInteract: () => {
          state.npcTalks++;
          console.log(`[npc] "Nice weather for scavenging." (talked ${state.npcTalks}x)`);
        },
      }),
    );

    // ── Coin: stands in for an inventory addon call ────────────────────────
    const coinEntity = this.spawnMarker("coin", 620, 300, 0xfacc15);
    coinEntity.add(
      new Interactable({
        prompt: "Pick up",
        onInteract: () => {
          state.coinsCollected++;
          coinEntity.destroy();
        },
      }),
    );

    // ── Door: live prompt provider, no re-wiring on toggle ─────────────────
    const door = this.spawnMarker("door", 180, 300, 0xa78bfa);
    door.add(
      new Interactable({
        prompt: () => (state.doorOpen ? "Close" : "Open"),
        onInteract: () => {
          state.doorOpen = !state.doorOpen;
        },
      }),
    );

    // ── Overlapping pair: focus tie-break by priority, deterministic ───────
    const crate = this.spawnMarker("crate", 400, 460, 0x94a3b8);
    crate.add(new Interactable({ prompt: "Search crate", onInteract: () => {} }));
    const chest = this.spawnMarker("chest", 400, 460, 0xf59e0b);
    chest.add(
      new Interactable({
        prompt: "Open quest chest",
        priority: 10,
        onInteract: () => console.log("[chest] the quest chest wins the tie every time"),
      }),
    );

    // E2E / console handle.
    exposeProbe({ interactor, state });
  }

  private spawnMarker(name: string, x: number, y: number, color: number): Entity {
    const e = this.spawn(name);
    e.add(new Transform({ position: new Vec2(x, y) }));
    e.add(
      new GraphicsComponent().draw((g) => {
        g.roundRect(-14, -14, 28, 28, 6).fill({ color, alpha: 0.9 });
        g.roundRect(-14, -14, 28, 28, 6).stroke({ color: 0xffffff, width: 1.5, alpha: 0.5 });
      }),
    );
    return e;
  }

  private drawRoom(): void {
    const bg = this.spawn("room-bg");
    bg.add(new Transform());
    bg.add(
      new GraphicsComponent().draw((g) => {
        g.rect(0, 0, WIDTH, HEIGHT).fill({ color: 0x0a0a0a });
        g.roundRect(24, 90, WIDTH - 48, HEIGHT - 140, 12).fill({ color: 0x14141f });
        g.roundRect(24, 90, WIDTH - 48, HEIGHT - 140, 12).stroke({ color: 0x2c2c4a, width: 2 });
      }),
    );
    const title = this.spawn("room-title");
    title.add(new Transform({ position: new Vec2(WIDTH / 2, 56) }));
    title.add(
      new TextComponent({
        text: "Walk up to anything and press E",
        style: { fontSize: 15, fill: 0x8888aa, fontFamily: "sans-serif" },
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
  }
}

// ── inspector/e2e probe ───────────────────────────────────────────────────────

interface InteractionProbeHandle {
  readonly interactor: Interactor;
  readonly state: DemoState;
}

function exposeProbe(handle: InteractionProbeHandle): void {
  (window as unknown as { __interaction__: InteractionProbeHandle }).__interaction__ = handle;
}

// ── boot ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(
    new InputPlugin({
      actions: {
        interact: ["KeyE", "Enter"],
        "move-up": ["ArrowUp", "KeyW"],
        "move-down": ["ArrowDown", "KeyS"],
        "move-left": ["ArrowLeft", "KeyA"],
        "move-right": ["ArrowRight", "KeyD"],
      },
      preventDefaultKeys: ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    }),
  );
  await engine.start();
  await engine.scenes.push(new InteractionRoomScene());
}

main().catch(console.error);
