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

import {
  Component,
  defineEvent,
  Engine,
  Entity,
  MathUtils,
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

// ── events the interactables emit on themselves ──────────────────────────────

const NpcTalked = defineEvent("npc:talked");
const CoinPickedUp = defineEvent("coin:picked-up");
const GemTaken = defineEvent("gem:taken");

// ── demo state (the "consequence" side of rules-in/consequences-out) ────────

/** What the player has done in the room. The NPC, the coin and the gems emit
 *  an event on themselves when used; the events bubble to the scene, where
 *  this component counts them. */
class RoomTally extends Component {
  npcTalks = 0;
  coinsCollected = 0;
  gemsTaken = 0;

  onAdd(): void {
    this.listenScene(NpcTalked, () => {
      this.npcTalks++;
      console.log(
        `[npc] "Nice weather for scavenging." (talked ${this.npcTalks}x)`,
      );
    });
    this.listenScene(CoinPickedUp, () => this.coinsCollected++);
    this.listenScene(GemTaken, () => this.gemsTaken++);
  }
}

/** Open or shut. The door's prompt reads it every frame. */
class Door extends Component {
  open = false;

  toggle(): void {
    this.open = !this.open;
  }
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
 *  something actually changed. Its entity is spawned after the player, so its
 *  input runs against that frame's freshly-resolved set. */
class InteractionMenu extends Component {
  private readonly input = this.service(InputManagerKey);
  private options: readonly Interactable[] = [];
  /** The highlighted target, held by identity rather than by index: `inRange`
   *  re-ranks as the player moves, so two equal-priority targets can swap
   *  places and an index would quietly start pointing at a different thing.
   *  `null` means "no explicit pick" — the focus. */
  private selected: Interactable | null = null;

  constructor(
    private readonly interactor: Interactor,
    private readonly view: MenuView,
  ) {
    super();
  }

  onAdd(): void {
    const player = this.interactor.entity;
    // The set in reach changed — including a NON-focused target entering or
    // leaving, which the focus event alone never reports. This is what a
    // selection UI has to listen to.
    this.listen(player, InteractionInRangeChangedEvent, ({ inRange }) => {
      this.options = inRange;
      // Drop a pick that walked out of reach; a re-rank alone keeps it.
      if (this.selected && !inRange.includes(this.selected))
        this.selected = null;
      this.render();
    });
    // The focus or its prompt text changed — the door's live "Open"/"Close".
    this.listen(player, InteractionFocusChangedEvent, () => this.render());
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

// ── entities ──────────────────────────────────────────────────────────────────

class PlayerEntity extends Entity {
  interactor!: Interactor;
  tally!: RoomTally;

  setup(): void {
    this.add(new Transform({ position: new Vec2(400, 300) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 16).fill({ color: 0x38bdf8 });
        g.circle(0, 0, 16).stroke({ color: 0x0ea5e9, width: 2 });
      }),
    );
    this.add(new PlayerMover());
    // action: null — the InteractionMenu owns the interact input so it can
    // act on the highlighted option, not just the focus.
    this.interactor = this.add(new Interactor({ range: 60, action: null }));
    this.tally = this.add(new RoomTally());
  }
}

/** The rounded square the NPC, the coin and the door are drawn as. */
function markerVisual(color: number): GraphicsComponent {
  return new GraphicsComponent().draw((g) => {
    g.roundRect(-14, -14, 28, 28, 6).fill({ color, alpha: 0.9 });
    g.roundRect(-14, -14, 28, 28, 6).stroke({
      color: 0xffffff,
      width: 1.5,
      alpha: 0.5,
    });
  });
}

/** Stands in for a dialogue addon call
 *  (`onInteract: () => dialogue.play(script)` in a real game). */
class NpcEntity extends Entity {
  setup(params: { x: number; y: number }): void {
    this.add(new Transform({ position: new Vec2(params.x, params.y) }));
    this.add(markerVisual(0xf97316));
    this.add(
      new Interactable({
        prompt: "Talk",
        onInteract: () => this.emit(NpcTalked),
      }),
    );
  }
}

/** Stands in for an inventory addon call. */
class CoinEntity extends Entity {
  setup(params: { x: number; y: number }): void {
    this.add(new Transform({ position: new Vec2(params.x, params.y) }));
    this.add(markerVisual(0xfacc15));
    this.add(
      new Interactable({
        prompt: "Pick up",
        onInteract: () => {
          this.emit(CoinPickedUp);
          this.destroy();
        },
      }),
    );
  }
}

/** A live prompt provider: the prompt follows the door's state with no
 *  re-wiring on toggle. */
class DoorEntity extends Entity {
  door!: Door;

  setup(params: { x: number; y: number }): void {
    this.add(new Transform({ position: new Vec2(params.x, params.y) }));
    this.add(markerVisual(0xa78bfa));
    const door = this.add(new Door());
    this.door = door;
    this.add(
      new Interactable({
        prompt: () => (door.open ? "Close" : "Open"),
        onInteract: () => door.toggle(),
      }),
    );
  }
}

/** One gem of the loot pile. */
class GemEntity extends Entity {
  setup(params: {
    x: number;
    y: number;
    color: number;
    prompt: string;
    priority: number;
  }): void {
    const { x, y, color, prompt, priority } = params;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 9).fill({ color });
        g.circle(0, 0, 9).stroke({ color: 0xffffff, width: 1.5, alpha: 0.6 });
      }),
    );
    this.add(
      new Interactable({
        prompt,
        priority,
        radius: 10, // a small reach bonus so the whole pile sits in one range
        onInteract: () => {
          this.emit(GemTaken);
          this.destroy();
        },
      }),
    );
  }
}

/** The menu UI: a fixed panel, top-right. The entity has no Transform, so
 *  its children's positions are screen pixels. */
class MenuEntity extends Entity {
  setup(params: { interactor: Interactor }): void {
    const panelEntity = this.spawnChild("menu-panel");
    panelEntity.add(new Transform({ position: new Vec2(WIDTH - 214, 98) }));
    const panel = panelEntity.add(
      new GraphicsComponent().draw((g) => {
        g.roundRect(0, 0, 190, 116, 8).fill({ color: 0x14141f, alpha: 0.92 });
        g.roundRect(0, 0, 190, 116, 8).stroke({ color: 0x2c2c4a, width: 1.5 });
      }),
    );
    const textEntity = this.spawnChild("menu-text");
    textEntity.add(new Transform({ position: new Vec2(WIDTH - 200, 110) }));
    const text = textEntity.add(
      new TextComponent({
        text: "",
        style: { fontSize: 14, fill: 0xffffff, fontFamily: "sans-serif" },
        anchor: { x: 0, y: 0 },
      }),
    );
    this.add(new InteractionMenu(params.interactor, new MenuView(panel, text)));
  }
}

// ── inspector probe ───────────────────────────────────────────────────────────

/** Inspector-readable state for a human poking around:
 *  `inspector.getComponentData("interaction-probe", "InteractionProbe")`. */
class InteractionProbe extends Component {
  constructor(
    private readonly player: PlayerEntity,
    private readonly door: DoorEntity,
  ) {
    super();
  }

  /** The focused target's prompt, or `null` when nothing is in range. */
  get focus(): string | null {
    return this.player.interactor.focus?.prompt ?? null;
  }

  /** The prompts of everything in range, best focus first. */
  get inRange(): string[] {
    return this.player.interactor.inRange.map((t) => t.prompt ?? "Interact");
  }

  get npcTalks(): number {
    return this.player.tally.npcTalks;
  }

  get coinsCollected(): number {
    return this.player.tally.coinsCollected;
  }

  get gemsTaken(): number {
    return this.player.tally.gemsTaken;
  }

  get doorOpen(): boolean {
    return this.door.door.open;
  }
}

// ── scene ─────────────────────────────────────────────────────────────────────

class InteractionRoomScene extends Scene {
  readonly name = "interaction-room";

  // The scene only assembles the room. The interactables report what
  // happened to them, and the player's RoomTally counts it.
  onEnter(): void {
    this.drawRoom();

    const player = this.spawn(PlayerEntity);
    this.spawn(NpcEntity, { x: 400, y: 150 });
    this.spawn(CoinEntity, { x: 620, y: 300 });
    const door = this.spawn(DoorEntity, { x: 180, y: 300 });

    // ── Loot pile: stacked targets → the selection menu ────────────────────
    // Three gems within one range circle. The ruby's priority makes it the
    // default (top of `inRange`); Q cycles to the others.
    this.spawn(GemEntity, {
      x: 390,
      y: 460,
      color: 0xef4444,
      prompt: "Take ruby",
      priority: 10,
    });
    this.spawn(GemEntity, {
      x: 410,
      y: 460,
      color: 0x10b981,
      prompt: "Take emerald",
      priority: 0,
    });
    this.spawn(GemEntity, {
      x: 400,
      y: 476,
      color: 0x3b82f6,
      prompt: "Take sapphire",
      priority: 0,
    });

    // Spawned after the player so the menu reads the in-range set the
    // player's Interactor resolved this frame, and draws above the room.
    this.spawn(MenuEntity, { interactor: player.interactor });

    this.spawn("interaction-probe").add(new InteractionProbe(player, door));
  }

  private drawRoom(): void {
    const bg = this.spawn("room-bg");
    bg.add(new Transform());
    bg.add(
      new GraphicsComponent().draw((g) => {
        g.rect(0, 0, WIDTH, HEIGHT).fill({ color: 0x0a0a0a });
        g.roundRect(24, 90, WIDTH - 48, HEIGHT - 140, 12).fill({
          color: 0x14141f,
        });
        g.roundRect(24, 90, WIDTH - 48, HEIGHT - 140, 12).stroke({
          color: 0x2c2c4a,
          width: 2,
        });
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
      preventDefaultKeys: [
        "Space",
        "Tab",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ],
    }),
  );
  await engine.start();
  await engine.scenes.push(new InteractionRoomScene());
}

main().catch(console.error);
