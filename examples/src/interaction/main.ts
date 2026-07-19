/**
 * Interaction addon example — one player `Interactor` meeting several
 * addons/patterns through the SAME `Interactable` marking, with zero
 * addon-to-addon coupling, plus a "which one?" selection menu for overlapping
 * targets:
 *
 *  • **An NPC** ("Talk") — stands in for a dialogue addon call
 *    (`onInteract: () => dialogue.play(script)` in a real game).
 *  • **A coin pickup** ("Pick up") — stands in for an inventory addon call;
 *    destroys itself and bumps a counter on interact.
 *  • **A door** (live "Open"/"Close" prompt) — toggles, proving the `prompt`
 *    provider re-resolves every frame with no re-wiring.
 *  • **A loot pile** (three stacked gems) — the selection case. When more than
 *    one thing is in range, the menu lists them ranked (the rare gem's higher
 *    `priority` makes it the default), Q cycles the highlight, and E takes the
 *    highlighted one via `interactor.interact(target)`.
 *
 * The addon is headless: this example owns 100% of the rendering, and drives
 * interaction itself (`action: null`) so the confirm key can act on the
 * highlighted option rather than always the focus. The `InteractionMenu`
 * controller listens to both interactor events — `InteractionInRangeChangedEvent`
 * for the ranked set behind the wheel, `InteractionFocusChangedEvent` for the
 * live prompt text — and the one menu doubles as the single-target prompt and
 * the multi-target wheel. A game that only ever needs "walk up, press E" can
 * skip all of this: render from the focus event and let the interactor
 * self-drive off `@yagejs/input`.
 *
 * Controls: WASD/arrows walk · E interact/take · Q cycle the selection.
 */

import { Component, Engine, type Entity, MathUtils, Scene, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent, RendererPlugin, TextComponent } from "@yagejs/renderer";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import {
  Interactable,
  InteractionFocusChangedEvent,
  InteractionInRangeChangedEvent,
  Interactor,
} from "@yagejs-addons/interaction";
import { setupGameContainer } from "../shared/bootstrap.js";


const WIDTH = 800;
const HEIGHT = 600;
const PLAYER_SPEED = 180;
const BOUNDS = { minX: 40, maxX: WIDTH - 40, minY: 100, maxY: HEIGHT - 40 };

// ── demo state (the "consequence" side of rules-in/consequences-out) ────────

interface DemoState {
  npcTalks: number;
  coinsCollected: number;
  gemsTaken: number;
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

// ── selection menu: reads inRange, cycles, confirms ─────────────────────────

/** Renders the ranked in-range set as a fixed panel: one row when a single
 *  thing is in range (a plain prompt), or a cyclable list when several
 *  overlap (`▶` marks the highlight). Hidden when nothing is in range. */
class MenuView {
  constructor(
    private readonly panel: GraphicsComponent,
    private readonly text: TextComponent,
  ) {}

  render(options: readonly Interactable[], selected: number): void {
    if (options.length === 0) {
      this.panel.visible = false;
      this.text.visible = false;
      return;
    }
    this.panel.visible = true;
    this.text.visible = true;

    if (options.length === 1) {
      const only = options[0];
      this.text.setText(`Press E\n${only?.prompt ?? "Interact"}`);
      return;
    }

    const rows = options
      .map((o, i) => `${i === selected ? "▶" : " "}  ${o.prompt ?? "Interact"}`)
      .join("\n");
    this.text.setText(`Q cycle · E take\n${rows}`);
  }
}

/** Drives interaction from the two interactor events, re-rendering only when
 *  something actually changed. Added after the `Interactor` so its input runs
 *  against that frame's freshly-resolved set. */
class InteractionMenu extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly interactor = this.sibling(Interactor);
  private options: readonly Interactable[] = [];
  /** The highlighted target, held by identity rather than by index: `inRange`
   *  re-ranks as the player moves, so two equal-priority targets can swap
   *  places and an index would quietly start pointing at a different thing.
   *  `null` means "no explicit pick" — the focus. */
  private selected: Interactable | null = null;

  constructor(private readonly view: MenuView) {
    super();
  }

  onAdd(): void {
    // The set in reach changed — including a NON-focused target entering or
    // leaving, which the focus event alone never reports. This is what a
    // selection UI has to listen to.
    this.listen(this.entity, InteractionInRangeChangedEvent, ({ inRange }) => {
      this.options = inRange;
      // Drop a pick that walked out of reach; a re-rank alone keeps it.
      if (this.selected && !inRange.includes(this.selected)) this.selected = null;
      this.render();
    });
    // The focus or its prompt text changed — the door's live "Open"/"Close".
    this.listen(this.entity, InteractionFocusChangedEvent, () => this.render());
    this.render();
  }

  update(): void {
    // Cycle only when there's a genuine choice between overlapping targets.
    if (this.options.length > 1 && this.input.isJustPressed("cycle")) {
      const next = (this.selectedIndex() + 1) % this.options.length;
      this.selected = this.options[next] ?? null;
      this.render();
    }

    // Confirm the highlighted option — the focus when only one is in range.
    if (this.input.isJustPressed("interact")) {
      this.interactor.interact(this.options[this.selectedIndex()]);
      this.selected = null;
    }
  }

  /** Where the highlight sits now. No explicit pick (or one that just left
   *  range) falls back to the focus, which is always `inRange[0]`. */
  private selectedIndex(): number {
    if (!this.selected) return 0;
    const index = this.options.indexOf(this.selected);
    return index === -1 ? 0 : index;
  }

  private render(): void {
    this.view.render(this.options, this.selectedIndex());
  }
}

// ── scene ─────────────────────────────────────────────────────────────────────

class InteractionRoomScene extends Scene {
  readonly name = "interaction-room";

  onEnter(): void {
    const state: DemoState = { npcTalks: 0, coinsCollected: 0, gemsTaken: 0, doorOpen: false };

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
    // action: null — the InteractionMenu below owns the interact input so it
    // can act on the highlighted option, not just the focus.
    const interactor = player.add(new Interactor({ range: 60, action: null }));

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

    // ── Loot pile: stacked targets → the selection menu ────────────────────
    // Three gems within one range circle. The ruby's priority makes it the
    // default (top of `inRange`); Q cycles to the others.
    this.spawnGem("ruby", 390, 460, 0xef4444, "Take ruby", 10, state);
    this.spawnGem("emerald", 410, 460, 0x10b981, "Take emerald", 0, state);
    this.spawnGem("sapphire", 400, 476, 0x3b82f6, "Take sapphire", 0, state);

    // ── the menu UI: fixed panel, top-right ────────────────────────────────
    const panelEntity = this.spawn("menu-panel");
    panelEntity.add(new Transform({ position: new Vec2(WIDTH - 214, 98) }));
    const panel = panelEntity.add(
      new GraphicsComponent().draw((g) => {
        g.roundRect(0, 0, 190, 116, 8).fill({ color: 0x14141f, alpha: 0.92 });
        g.roundRect(0, 0, 190, 116, 8).stroke({ color: 0x2c2c4a, width: 1.5 });
      }),
    );
    const menuTextEntity = this.spawn("menu-text");
    menuTextEntity.add(new Transform({ position: new Vec2(WIDTH - 200, 110) }));
    const menuText = menuTextEntity.add(
      new TextComponent({
        text: "",
        style: { fontSize: 14, fill: 0xffffff, fontFamily: "sans-serif" },
        anchor: { x: 0, y: 0 },
      }),
    );
    player.add(new InteractionMenu(new MenuView(panel, menuText)));

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

  private spawnGem(
    name: string,
    x: number,
    y: number,
    color: number,
    prompt: string,
    priority: number,
    state: DemoState,
  ): Entity {
    const e = this.spawn(name);
    e.add(new Transform({ position: new Vec2(x, y) }));
    e.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 9).fill({ color });
        g.circle(0, 0, 9).stroke({ color: 0xffffff, width: 1.5, alpha: 0.6 });
      }),
    );
    e.add(
      new Interactable({
        prompt,
        priority,
        radius: 10, // a small reach bonus so the whole pile sits in one range
        onInteract: () => {
          state.gemsTaken++;
          e.destroy();
        },
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
        text: "Walk up and press E · stack onto the gems, then Q to cycle",
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
        cycle: ["KeyQ", "Tab"],
        "move-up": ["ArrowUp", "KeyW"],
        "move-down": ["ArrowDown", "KeyS"],
        "move-left": ["ArrowLeft", "KeyA"],
        "move-right": ["ArrowRight", "KeyD"],
      },
      preventDefaultKeys: ["Space", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    }),
  );
  await engine.start();
  await engine.scenes.push(new InteractionRoomScene());
}

main().catch(console.error);
