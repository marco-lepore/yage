/**
 * Quests addon example — a tiny two-quest chain that proves the binding
 * shape `@yagejs-addons/quests` is built for: objectives driven by OTHER
 * addons' events, with no addon->addon dependency.
 *
 *  • **Accept** — talking to the healer NPC (E to interact) runs a
 *    `@yagejs-addons/dialogue` box conversation whose `acceptQuest` command
 *    starts `gatherHerbs`. Herbs picked up before accepting are credited at
 *    that moment (`setProgress` from the inventory count) — the
 *    count-on-accept idiom, since advancing a quest that isn't active is a
 *    silent no-op.
 *  • **Gather Herbs** — a WASD player walks over 5 herb pickups, which land in
 *    a headless `@yagejs-addons/inventory` `Inventory`. Its `itemAdded` model
 *    event advances the `herb` objective directly — one line, no UI needed.
 *  • **Turn-in** — talking to the healer again once the herbs are gathered
 *    jumps to the turn-in node (the script conditions on `herbsDone()`, a
 *    function reading the quest log), whose `turnIn` command completes the
 *    `turnIn` objective.
 *  • **Chaining** — `gatherHerbs` completing (both objectives satisfied — the
 *    auto-complete rollup) starts `thinThePack` via one `on("questCompleted",
 *    …)` line. That quest's `wolf` objective advances from the game's own
 *    `WolfDefeated` entity event, which a wolf emits when the player presses
 *    E next to it — a third, unrelated event source.
 *  • **The log gates it** — every binding above fires unconditionally; none
 *    guards on "is this quest active?" themselves. Advancing wolves before
 *    `thinThePack` starts is a silent no-op.
 *
 * The quest log, the inventory and the three bindings live in the `Journal`
 * component on a keyed host entity. A `QuestController` on the same entity
 * re-emits the log's changes as entity events on that entity, and they bubble
 * to the scene: the HUD redraws on `QuestChangedEvent` and toasts on
 * `QuestCompletedEvent`, both heard at the scene.
 *
 * Controls: WASD/arrows walk · E interact/talk/defeat.
 */

import {
  Component,
  defineEvent,
  Engine,
  Entity,
  MathUtils,
  ProcessComponent,
  Scene,
  Transform,
  Vec2,
  type ProcessSlot,
} from "@yagejs/core";
import {
  CameraEntity,
  GraphicsComponent,
  RendererPlugin,
  TextComponent,
  type LayerDef,
} from "@yagejs/renderer";
import { DebugPlugin } from "@yagejs/debug";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import { defineItems, Inventory } from "@yagejs-addons/inventory";
import { DialogueController, defineScript } from "@yagejs-addons/dialogue";
import {
  createBoxDialogue,
  DIALOGUE_LAYERS,
} from "@yagejs-addons/dialogue/presenters";
import {
  defineQuests,
  QuestCatalog,
  QuestChangedEvent,
  QuestController,
  QuestCompletedEvent,
  QuestLog,
  type QuestStatus,
} from "@yagejs-addons/quests";
import { setupGameContainer } from "../shared/bootstrap.js";

// ---------------------------------------------------------------------------
// Constants, spawn keys and events
// ---------------------------------------------------------------------------

const WIDTH = 800;
const HEIGHT = 600;
const PLAYER_SPEED = 175;
/** How long a toast stays on screen, in seconds. */
const TOAST_SECONDS = 2.6;

const ROOM_LAYER = "room";
const HUD_LAYER = "hud";
const LAYERS: LayerDef[] = [
  { name: ROOM_LAYER, order: 10, space: "world" },
  ...DIALOGUE_LAYERS,
  { name: HUD_LAYER, order: 1200, space: "screen" },
];

const HERB_SPOTS: [number, number][] = [
  [260, 200],
  [340, 420],
  [460, 160],
  [560, 340],
  [420, 480],
];
const WOLF_SPOTS: [number, number][] = [
  [620, 460],
  [680, 520],
  [560, 500],
];

// Spawn keys, for `scene.findByKey`.
const PLAYER_KEY = "player";
const JOURNAL_KEY = "journal";
const DIALOGUE_KEY = "dialogue";

/** A wolf was defeated. The wolf emits it on itself; it bubbles to the
 *  scene, where the journal hears it. */
const WolfDefeated = defineEvent("wolf:defeated");

// ---------------------------------------------------------------------------
// The quest catalog — two-level id capture, quest id -> per-quest objective id
// ---------------------------------------------------------------------------

const QUESTS = defineQuests({
  gatherHerbs: {
    title: "Gather Herbs",
    summary: "The healer needs 5 red herbs, then wants them delivered.",
    objectives: {
      herb: { title: "Collect red herbs", count: 5 },
      turnIn: { title: "Return to the healer" },
    },
  },
  thinThePack: {
    title: "Thin the Pack",
    requires: ["gatherHerbs"],
    summary: "Wolves prowl the clearing east of the healer's hut.",
    objectives: { wolf: { title: "Defeat wolves", count: 3 } },
  },
});

/** The literal quest/objective id space `QUESTS` captured — extracted once so
 *  `QuestLog<Defs>` doesn't repeat the `defineQuests` call's inline type. */
type Defs = typeof QUESTS extends QuestCatalog<infer D> ? D : never;

/** The item the herbs land as. A headless inventory: no panel shows it. */
const ITEMS = defineItems({ redHerb: { name: "Red Herb", maxStack: 10 } });

// ---------------------------------------------------------------------------
// The healer's script — its condition reads quest progress via a function
// ---------------------------------------------------------------------------

const healerScript = defineScript({
  id: "healer",
  start: "greet",
  speakers: { healer: { name: "Healer", color: 0xffd866 } },
  nodes: {
    greet: {
      id: "greet",
      steps: [
        {
          kind: "command",
          commands: [],
          condition: "herbsDone()",
          target: "turnIn",
        },
        {
          kind: "say",
          speaker: "healer",
          text: "Bring me 5 red herbs from the clearing and I'll reward you.",
        },
        { kind: "command", commands: [{ type: "acceptQuest" }] },
        { kind: "end" },
      ],
    },
    turnIn: {
      id: "turnIn",
      steps: [
        {
          kind: "say",
          speaker: "healer",
          text: "You found them all! Thank you, traveler.",
        },
        { kind: "command", commands: [{ type: "turnIn" }] },
        { kind: "end" },
      ],
    },
  },
});

// ---------------------------------------------------------------------------
// Journal — the game state and the objective bindings
// ---------------------------------------------------------------------------

/**
 * The run's game state: the quest log and the inventory the herbs land in.
 * The three objective bindings live here, one line each and none guarded:
 * the log ignores progress on a quest that isn't active.
 */
class Journal extends Component {
  readonly log = new QuestLog(QUESTS);
  readonly inventory = new Inventory({ catalog: ITEMS });

  onAdd(): void {
    // An inventory model event advances the herb objective.
    this.addCleanup(
      this.inventory.on("itemAdded", (e) => {
        if (e.itemId === "redHerb")
          this.log.advance("gatherHerbs", "herb", e.quantity);
      }),
    );
    // Finishing the herbs starts the wolf hunt.
    this.addCleanup(
      this.log.on("questCompleted", ({ questId }) => {
        if (questId === "gatherHerbs") this.log.start("thinThePack");
      }),
    );
    // The game's own entity event advances the wolf objective.
    this.listenScene(WolfDefeated, () =>
      this.log.advance("thinThePack", "wolf"),
    );
  }

  /** The script's `herbsDone()` condition. */
  herbsGathered(): boolean {
    return this.log.objectiveDone("gatherHerbs", "herb");
  }

  /** The script's `acceptQuest` command. Credits herbs picked up before
   *  accepting: advancing a quest that isn't active is a silent no-op, so
   *  the accept seeds progress from the inventory count. */
  acceptHerbQuest(): void {
    this.log.start("gatherHerbs");
    this.log.setProgress(
      "gatherHerbs",
      "herb",
      this.inventory.count("redHerb"),
    );
  }

  /** The script's `turnIn` command. */
  turnInHerbs(): void {
    this.log.complete("gatherHerbs", "turnIn");
  }
}

/** Hosts the journal, plus the `QuestController` that emits its log's
 *  changes on this entity as `QuestCompletedEvent`, `QuestChangedEvent` and
 *  the rest; they bubble to the scene. Spawned with `JOURNAL_KEY`. */
class JournalEntity extends Entity {
  journal!: Journal;

  setup(): void {
    this.journal = this.add(new Journal());
    this.add(new QuestController({ log: this.journal.log }));
  }
}

// ---------------------------------------------------------------------------
// Dialogue — the box conversation the healer plays
// ---------------------------------------------------------------------------

/** The dialogue box. The healer's script reads the journal through
 *  `herbsDone()` and changes it through two commands. Spawned with
 *  `DIALOGUE_KEY`. */
class DialogueEntity extends Entity {
  dialogue!: DialogueController;

  setup(params: { journal: Journal }): void {
    const { journal } = params;
    this.dialogue = this.add(
      new DialogueController({
        ...createBoxDialogue(),
        functions: { herbsDone: () => journal.herbsGathered() },
        commands: {
          acceptQuest: () => journal.acceptHerbQuest(),
          turnIn: () => journal.turnInHerbs(),
        },
      }),
    );
  }
}

/** Whether a conversation owns input. Movement and the wolves wait then. */
function isTalking(scene: Scene): boolean {
  return (
    scene.findByKey<DialogueEntity>(DIALOGUE_KEY)?.dialogue.isActive() ?? false
  );
}

/** How far the player stands from `transform`, in pixels. */
function playerDistance(scene: Scene, transform: Transform): number {
  const player = scene.findByKey(PLAYER_KEY);
  if (!player) return Infinity;
  const p = player.get(Transform).position;
  const me = transform.position;
  return Math.hypot(me.x - p.x, me.y - p.y);
}

// ---------------------------------------------------------------------------
// The player
// ---------------------------------------------------------------------------

/** WASD/arrow movement, frozen while a conversation owns input. */
class PlayerMover extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);

  update(dt: number): void {
    if (isTalking(this.scene)) return;
    const dx = this.input.getAxis("move-left", "move-right");
    const dy = this.input.getAxis("move-up", "move-down");
    if (dx === 0 && dy === 0) return;
    const len = Math.hypot(dx, dy) || 1;
    const step = PLAYER_SPEED * dt;
    const p = this.transform.position;
    this.transform.setPosition(
      MathUtils.clamp(p.x + (dx / len) * step, 24, WIDTH - 24),
      MathUtils.clamp(p.y + (dy / len) * step, 100, HEIGHT - 24),
    );
  }
}

/** The player. Spawned with `PLAYER_KEY`. */
class PlayerEntity extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(120, 300) }));
    this.add(
      new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
        g.circle(0, 0, 12).fill({ color: 0x6be08a });
        g.circle(0, 0, 12).stroke({ color: 0xffffff, width: 2, alpha: 0.7 });
      }),
    );
    this.add(new PlayerMover());
  }
}

// ---------------------------------------------------------------------------
// Herbs, the healer and the wolves
// ---------------------------------------------------------------------------

/** A herb on the ground: walk over it and it lands in the inventory, then
 *  destroys itself. The inventory's `itemAdded` model event, not this
 *  component, drives the quest objective. */
class HerbPickup extends Component {
  private readonly transform = this.sibling(Transform);

  update(): void {
    if (playerDistance(this.scene, this.transform) > 20) return;
    const journal = this.scene.findByKey<JournalEntity>(JOURNAL_KEY)?.journal;
    if (!journal) return;
    journal.inventory.add("redHerb", 1);
    this.entity.destroy();
  }
}

class HerbEntity extends Entity {
  setup(params: { x: number; y: number }): void {
    this.add(new Transform({ position: new Vec2(params.x, params.y) }));
    this.add(
      new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
        g.circle(0, 0, 6).fill({ color: 0xd83a3a });
        g.circle(0, 0, 6).stroke({ color: 0xffffff, width: 1, alpha: 0.6 });
      }),
    );
    this.add(new HerbPickup());
  }
}

/** A small prompt above an NPC or a wolf, hidden until the player is in
 *  range. Spawned as a child, so it goes when its owner does; its position
 *  is relative to the owner. */
class PromptEntity extends Entity {
  text!: TextComponent;

  setup(params: { text: string; offsetY: number }): void {
    this.add(new Transform({ position: new Vec2(0, params.offsetY) }));
    this.text = this.add(
      new TextComponent({
        text: params.text,
        style: { fontSize: 11, fill: 0xffffff, fontFamily: "sans-serif" },
        layer: ROOM_LAYER,
        anchor: { x: 0.5, y: 0.5 },
        visible: false,
      }),
    );
  }
}

/** The healer NPC: E opens the box conversation when in range and none is
 *  active. */
class Healer extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);

  constructor(private readonly prompt: TextComponent) {
    super();
  }

  update(): void {
    const dialogue =
      this.scene.findByKey<DialogueEntity>(DIALOGUE_KEY)?.dialogue;
    if (!dialogue) return;
    const near =
      !dialogue.isActive() && playerDistance(this.scene, this.transform) <= 34;
    this.prompt.visible = near;
    if (near && this.input.isJustPressed("interact"))
      dialogue.play(healerScript);
  }
}

class HealerEntity extends Entity {
  setup(params: { x: number; y: number }): void {
    this.add(new Transform({ position: new Vec2(params.x, params.y) }));
    this.add(
      new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
        g.roundRect(-11, -16, 22, 32, 6).fill({ color: 0xffd866 });
        g.roundRect(-11, -16, 22, 32, 6).stroke({
          color: 0xffffff,
          width: 1.5,
          alpha: 0.6,
        });
      }),
    );
    const prompt = this.spawnChild("prompt", PromptEntity, {
      text: "E talk",
      offsetY: -26,
    });
    this.add(new Healer(prompt.text));
  }
}

/** A wolf: press E in range to defeat it. It emits `WolfDefeated`, the
 *  `thinThePack` objective's binding source, unrelated to inventory and
 *  dialogue on purpose. */
class Wolf extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);

  constructor(private readonly prompt: TextComponent) {
    super();
  }

  update(): void {
    const near =
      !isTalking(this.scene) &&
      playerDistance(this.scene, this.transform) <= 30;
    this.prompt.visible = near;
    if (near && this.input.isJustPressed("interact")) {
      this.entity.emit(WolfDefeated);
      this.entity.destroy();
    }
  }
}

class WolfEntity extends Entity {
  setup(params: { x: number; y: number }): void {
    this.add(new Transform({ position: new Vec2(params.x, params.y) }));
    this.add(
      new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
        g.roundRect(-13, -8, 26, 16, 5).fill({ color: 0x555566 });
        g.roundRect(-13, -8, 26, 16, 5).stroke({
          color: 0xcccccc,
          width: 1,
          alpha: 0.6,
        });
      }),
    );
    const prompt = this.spawnChild("prompt", PromptEntity, {
      text: "E defeat",
      offsetY: -20,
    });
    this.add(new Wolf(prompt.text));
  }
}

// ---------------------------------------------------------------------------
// The HUD
// ---------------------------------------------------------------------------

/**
 * Lists active quests and objective progress by reading the log directly —
 * the "no presenter needed" reader surface (`active()` + `get()`). It
 * redraws when the mirrored `QuestChangedEvent` says the log changed, and
 * shows a toast for `TOAST_SECONDS` when a quest completes.
 */
class QuestHud extends Component {
  private readonly processes = this.sibling(ProcessComponent);
  /** Running while the current toast is on screen. */
  private toastLife!: ProcessSlot;
  private _toast = "";

  constructor(
    private readonly log: QuestLog<Defs>,
    private readonly text: TextComponent,
  ) {
    super();
  }

  /** The toast on screen, or "" when none is. */
  get toast(): string {
    return this._toast;
  }

  onAdd(): void {
    this.toastLife = this.processes.slot({
      duration: TOAST_SECONDS,
      onComplete: () => {
        this._toast = "";
        this.redraw();
      },
    });
    this.listenScene(QuestChangedEvent, () => this.redraw());
    this.listenScene(QuestCompletedEvent, ({ questId }) => {
      // Event payloads carry `string` ids (event tokens can't be generic);
      // `tryGet` reads the title without narrowing back to the literal union.
      this._toast = `Quest complete: ${QUESTS.tryGet(questId)?.title ?? questId}`;
      this.toastLife.restart();
      this.redraw();
    });
    this.redraw();
  }

  private redraw(): void {
    const lines: string[] = [];
    for (const questId of this.log.active()) {
      const def = QUESTS.get(questId);
      const progress = this.log.get(questId).objectives;
      lines.push(def.title);
      for (const [objId, objDef] of def.objectives) {
        lines.push(
          `  ${objDef.title ?? objId}: ${progress[objId] ?? 0}/${objDef.count}`,
        );
      }
    }
    if (this._toast) lines.push("", this._toast);
    this.text.setText(lines.join("\n") || "(no active quests)");
  }
}

class QuestHudEntity extends Entity {
  hud!: QuestHud;

  setup(params: { log: QuestLog<Defs> }): void {
    // The HUD entity has no Transform, so the text's position is in screen
    // pixels.
    const line = this.spawnChild("text");
    line.add(new Transform({ position: new Vec2(16, 14) }));
    const text = line.add(
      new TextComponent({
        text: "",
        style: { fontSize: 13, fill: 0xf0f0f0, fontFamily: "sans-serif" },
        layer: HUD_LAYER,
      }),
    );
    this.add(new ProcessComponent());
    this.hud = this.add(new QuestHud(params.log, text));
  }
}

// ---------------------------------------------------------------------------
// Inspector probe
// ---------------------------------------------------------------------------

/**
 * Inspector-readable state for e2e tests and for a human poking around:
 * `inspector.getComponentData("quests-probe", "QuestsProbe")`.
 */
class QuestsProbe extends Component {
  constructor(
    private readonly journal: Journal,
    private readonly dialogue: DialogueController,
    private readonly hud: QuestHud,
  ) {
    super();
  }

  get gatherHerbs(): QuestStatus {
    return this.journal.log.status("gatherHerbs");
  }

  get thinThePack(): QuestStatus {
    return this.journal.log.status("thinThePack");
  }

  get herbs(): number {
    return this.journal.log.progress("gatherHerbs", "herb");
  }

  get turnedIn(): number {
    return this.journal.log.progress("gatherHerbs", "turnIn");
  }

  get wolves(): number {
    return this.journal.log.progress("thinThePack", "wolf");
  }

  get herbsHeld(): number {
    return this.journal.inventory.count("redHerb");
  }

  get talking(): boolean {
    return this.dialogue.isActive();
  }

  get toast(): string {
    return this.hud.toast;
  }
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

class QuestsRoomScene extends Scene {
  readonly name = "quests-addon";
  readonly layers = LAYERS;

  // The scene only assembles the room. The journal holds the quest state and
  // its bindings; the herbs, the healer and the wolves hold their own rules.
  onEnter(): void {
    this.drawRoom();
    this.spawn(PlayerEntity, { key: PLAYER_KEY });
    this.spawn(CameraEntity, { position: new Vec2(WIDTH / 2, HEIGHT / 2) });
    const journal = this.spawn(JournalEntity, { key: JOURNAL_KEY }).journal;
    const dialogue = this.spawn(
      DialogueEntity,
      { journal },
      { key: DIALOGUE_KEY },
    ).dialogue;
    const hud = this.spawn(QuestHudEntity, { log: journal.log }).hud;
    for (const [x, y] of HERB_SPOTS) this.spawn(HerbEntity, { x, y });
    this.spawn(HealerEntity, { x: 700, y: 300 });
    // Wolves can be defeated any time, but the log ignores them until
    // thinThePack is active.
    for (const [x, y] of WOLF_SPOTS) this.spawn(WolfEntity, { x, y });
    this.spawn("quests-probe").add(new QuestsProbe(journal, dialogue, hud));
  }

  private drawRoom(): void {
    const bg = this.spawn("room-bg");
    bg.add(new Transform());
    bg.add(
      new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
        g.rect(0, 0, WIDTH, HEIGHT).fill({ color: 0x10101c });
        g.roundRect(16, 90, WIDTH - 32, HEIGHT - 106, 12).fill({
          color: 0x181828,
        });
        g.roundRect(16, 90, WIDTH - 32, HEIGHT - 106, 12).stroke({
          color: 0x2c2c4a,
          width: 2,
        });
      }),
    );
    const title = this.spawn("room-title");
    title.add(new Transform({ position: new Vec2(WIDTH / 2, 56) }));
    title.add(
      new TextComponent({
        text: "Talk to the healer, gather herbs, turn them in, then thin the pack",
        style: { fontSize: 15, fill: 0x8888aa, fontFamily: "sans-serif" },
        layer: ROOM_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
    const controls = this.spawn("room-controls");
    controls.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT - 14) }));
    controls.add(
      new TextComponent({
        text: "WASD move · E interact",
        style: { fontSize: 11, fill: 0x8888aa, fontFamily: "sans-serif" },
        layer: ROOM_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

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
      preventDefaultKeys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    }),
  );
  engine.use(new DebugPlugin());
  await engine.start();
  await engine.scenes.push(new QuestsRoomScene());
}

main().catch(console.error);
