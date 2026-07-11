/**
 * Quests addon example — a tiny two-quest chain that proves the binding
 * shape `@yagejs-addons/quests` is built for: objectives driven by OTHER
 * addons' events, with no addon->addon dependency.
 *
 *  • **Gather Herbs** — a WASD player walks over 5 herb pickups, which land in
 *    a headless `@yagejs-addons/inventory` `Inventory`. Its `itemAdded` model
 *    event advances the `herb` objective directly — one line, no UI needed.
 *  • **Turn-in** — talking to the healer NPC (E to interact) runs a
 *    `@yagejs-addons/dialogue` box conversation whose `[turnIn/]` command
 *    completes the `turnIn` objective. The script conditions on the herb
 *    objective's own progress (`herbsDone()`, a function reading the quest
 *    log) so the healer's line changes once you've gathered enough.
 *  • **Chaining** — `gatherHerbs` completing (both objectives satisfied — the
 *    auto-complete rollup) starts `thinThePack` via one `on("questCompleted",
 *    …)` line. That quest's `wolf` objective advances from the player's own
 *    "defeat" entity event (E near a wolf) — a third, unrelated event source.
 *  • **The log gates it** — every binding above fires unconditionally; none
 *    guards on "is this quest active?" themselves. Advancing wolves before
 *    `thinThePack` starts is a silent no-op.
 *
 * A `QuestController` mirrors the log onto the engine bus (optional — the HUD
 * below reads the log directly) to prove the bus-mirror path: a toast fires
 * from `scene.on(QuestCompletedEvent, …)`.
 *
 * Controls: WASD/arrows walk · E interact/talk/defeat.
 */

import { Component, Engine, MathUtils, Scene, Transform, Vec2 } from "@yagejs/core";
import {
  CameraEntity,
  GraphicsComponent,
  RendererPlugin,
  TextComponent,
  type LayerDef,
} from "@yagejs/renderer";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import { defineItems, Inventory } from "@yagejs-addons/inventory";
import { DialogueController, defineScript } from "@yagejs-addons/dialogue";
import { createBoxDialogue, DIALOGUE_LAYERS } from "@yagejs-addons/dialogue/presenters";
import {
  defineQuests,
  QuestCatalog,
  QuestController,
  QuestCompletedEvent,
  QuestLog,
} from "@yagejs-addons/quests";
import { setupGameContainer } from "./shared.js";

const WIDTH = 800;
const HEIGHT = 600;
const PLAYER_SPEED = 175;

const ROOM_LAYER = "room";
const HUD_LAYER = "hud";
const LAYERS: LayerDef[] = [
  { name: ROOM_LAYER, order: 10, space: "world" },
  ...DIALOGUE_LAYERS,
  { name: HUD_LAYER, order: 1200, space: "screen" },
];

// ── the quest catalog — two-level id capture, quest id -> per-quest objective id ──

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

// ── the inventory herbs land in — headless, no panel needed for this demo ──

const ITEMS = defineItems({ redHerb: { name: "Red Herb", maxStack: 10 } });

// ── world components ──────────────────────────────────────────────────────

/** WASD/arrow movement, frozen while a conversation owns input. */
class PlayerMover extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);

  constructor(private readonly isBusy: () => boolean) {
    super();
  }

  update(dt: number): void {
    if (this.isBusy()) return;
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

/** A herb on the ground: walk over it and it lands in the inventory, then
 *  destroys itself. The `itemAdded` model event (not this component) is what
 *  drives the quest objective — this just makes the herb collectible. */
class HerbPickup extends Component {
  constructor(
    private readonly cfg: { readonly playerPos: () => Vec2; readonly inventory: Inventory<"redHerb"> },
  ) {
    super();
  }

  update(): void {
    const me = this.entity.get(Transform).position;
    if (Math.hypot(me.x - this.cfg.playerPos().x, me.y - this.cfg.playerPos().y) > 20) return;
    this.cfg.inventory.add("redHerb", 1);
    this.entity.destroy();
  }
}

/** A wolf: press E in range to defeat it — the `thinThePack` objective's
 *  binding source, unrelated to inventory/dialogue on purpose. */
class Wolf extends Component {
  private readonly input = this.service(InputManagerKey);
  private prompt!: TextComponent;

  constructor(
    private readonly cfg: {
      readonly playerPos: () => Vec2;
      readonly isBusy: () => boolean;
      readonly onDefeated: () => void;
    },
  ) {
    super();
  }

  onAdd(): void {
    const here = this.entity.get(Transform).position;
    const tip = this.scene.spawn("wolf-prompt");
    tip.add(new Transform({ position: new Vec2(here.x, here.y - 20) }));
    this.prompt = tip.add(
      new TextComponent({
        text: "E defeat",
        style: { fontSize: 11, fill: 0xffffff, fontFamily: "sans-serif" },
        layer: ROOM_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
    this.prompt.text.visible = false;
  }

  onDestroy(): void {
    this.prompt.entity.destroy();
  }

  update(): void {
    const me = this.entity.get(Transform).position;
    const near = !this.cfg.isBusy() && Math.hypot(me.x - this.cfg.playerPos().x, me.y - this.cfg.playerPos().y) <= 30;
    this.prompt.text.visible = near;
    if (near && this.input.isJustPressed("interact")) {
      this.cfg.onDefeated();
      this.entity.destroy();
    }
  }
}

/** The healer NPC: E opens a box conversation when in range and none is active. */
class Healer extends Component {
  private readonly input = this.service(InputManagerKey);
  private prompt!: TextComponent;

  constructor(
    private readonly cfg: {
      readonly playerPos: () => Vec2;
      readonly dialogue: DialogueController;
    },
  ) {
    super();
  }

  onAdd(): void {
    const here = this.entity.get(Transform).position;
    const tip = this.scene.spawn("healer-prompt");
    tip.add(new Transform({ position: new Vec2(here.x, here.y - 26) }));
    this.prompt = tip.add(
      new TextComponent({
        text: "E talk",
        style: { fontSize: 11, fill: 0xffffff, fontFamily: "sans-serif" },
        layer: ROOM_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
    this.prompt.text.visible = false;
  }

  update(): void {
    const me = this.entity.get(Transform).position;
    const near = !this.cfg.dialogue.isActive() && Math.hypot(me.x - this.cfg.playerPos().x, me.y - this.cfg.playerPos().y) <= 34;
    this.prompt.text.visible = near;
    if (near && this.input.isJustPressed("interact")) this.cfg.dialogue.play(healerScript);
  }
}

/** Lists active quests + objective progress by reading the log directly — the
 *  "no presenter needed" reader surface (`active()` + `get()`). */
class QuestHud extends Component {
  private text!: TextComponent;
  private toast = "";
  private toastTtl = 0;

  constructor(private readonly log: QuestLog<Defs>) {
    super();
  }

  onAdd(): void {
    const e = this.scene.spawn("quest-hud-text");
    e.add(new Transform({ position: new Vec2(16, 14) }));
    this.text = e.add(
      new TextComponent({
        text: "",
        style: { fontSize: 13, fill: 0xf0f0f0, fontFamily: "sans-serif" },
        layer: HUD_LAYER,
      }),
    );
  }

  showToast(message: string): void {
    this.toast = message;
    this.toastTtl = 2.6;
  }

  update(dt: number): void {
    if (this.toastTtl > 0) {
      this.toastTtl -= dt;
      if (this.toastTtl <= 0) this.toast = "";
    }
    const lines: string[] = [];
    for (const questId of this.log.active()) {
      const def = QUESTS.get(questId);
      lines.push(def.title);
      for (const objId of def.objectiveIds) {
        const objDef = def.objectives.get(objId)!;
        const p = this.log.get(questId).objectives[objId] ?? 0;
        lines.push(`  ${objDef.title ?? objId}: ${p}/${objDef.count}`);
      }
    }
    if (this.toast) lines.push("", this.toast);
    this.text.text.text = lines.join("\n") || "(no active quests)";
  }
}

// ── the healer's script — condition reads quest progress via a function ────

const healerScript = defineScript({
  id: "healer",
  start: "greet",
  speakers: { healer: { name: "Healer", color: 0xffd866 } },
  nodes: {
    greet: {
      id: "greet",
      steps: [
        { kind: "command", commands: [], condition: "herbsDone()", target: "turnIn" },
        {
          kind: "say",
          speaker: "healer",
          text: "Bring me 5 red herbs from the clearing and I'll reward you.",
        },
        { kind: "end" },
      ],
    },
    turnIn: {
      id: "turnIn",
      steps: [
        { kind: "say", speaker: "healer", text: "You found them all! Thank you, traveler." },
        { kind: "command", commands: [{ type: "turnIn" }] },
        { kind: "end" },
      ],
    },
  },
});

// ── the scene ────────────────────────────────────────────────────────────

class QuestsRoomScene extends Scene {
  readonly name = "quests-addon";
  readonly layers = LAYERS;

  onEnter(): void {
    this.drawRoom();

    const log = new QuestLog(QUESTS);
    const inventory = new Inventory({ catalog: ITEMS });

    // Player.
    const player = this.spawn("player");
    player.add(new Transform({ position: new Vec2(120, 300) }));
    const playerGfx = player.add(new GraphicsComponent({ layer: ROOM_LAYER }));
    playerGfx.draw((g) => {
      g.circle(0, 0, 12).fill({ color: 0x6be08a });
      g.circle(0, 0, 12).stroke({ color: 0xffffff, width: 2, alpha: 0.7 });
    });
    const playerPos = (): Vec2 => player.get(Transform).position;

    this.spawn(CameraEntity, { position: new Vec2(WIDTH / 2, HEIGHT / 2) });

    // Dialogue host — the healer's conversations play through it.
    const dialogueHost = this.spawn("dialogue");
    const dialogue = dialogueHost.add(
      new DialogueController({
        ...createBoxDialogue(),
        functions: { herbsDone: () => log.objectiveDone("gatherHerbs", "herb") },
        commands: { turnIn: () => log.complete("gatherHerbs", "turnIn") },
      }),
    );
    const busy = (): boolean => dialogue.isActive();

    // Optional engine-bus mirror — proves the bus-mirror path; the HUD below
    // reads the log directly instead, since it doesn't need one.
    const questHost = this.spawn("quest-log");
    questHost.add(new QuestController({ log }));

    const hud = this.spawn("quest-hud").add(new QuestHud(log));
    this.on(QuestCompletedEvent, ({ questId }) => {
      // Bus payloads carry `string` ids (event tokens can't be generic);
      // `tryGet` reads the title without narrowing back to the literal union.
      hud.showToast(`Quest complete: ${QUESTS.tryGet(questId)?.title ?? questId}`);
    });

    // ── the binding wires: three unrelated event sources, one guardless line each ──
    inventory.on("itemAdded", (e) => {
      if (e.itemId === "redHerb") log.advance("gatherHerbs", "herb", e.quantity);
    });
    log.on("questCompleted", ({ questId }) => {
      if (questId === "gatherHerbs") log.start("thinThePack");
    });

    // Herb pickups.
    const herbSpots: [number, number][] = [
      [260, 200],
      [340, 420],
      [460, 160],
      [560, 340],
      [420, 480],
    ];
    for (const [x, y] of herbSpots) {
      const e = this.spawn("herb");
      e.add(new Transform({ position: new Vec2(x, y) }));
      e.add(
        new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
          g.circle(0, 0, 6).fill({ color: 0xd83a3a });
          g.circle(0, 0, 6).stroke({ color: 0xffffff, width: 1, alpha: 0.6 });
        }),
      );
      e.add(new HerbPickup({ playerPos, inventory }));
    }

    // Healer.
    const healer = this.spawn("healer");
    healer.add(new Transform({ position: new Vec2(700, 300) }));
    healer.add(
      new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
        g.roundRect(-11, -16, 22, 32, 6).fill({ color: 0xffd866 });
        g.roundRect(-11, -16, 22, 32, 6).stroke({ color: 0xffffff, width: 1.5, alpha: 0.6 });
      }),
    );
    healer.add(new Healer({ playerPos, dialogue }));

    // Wolves — the thinThePack binding source; killable any time, but the log
    // ignores it until thinThePack is active.
    const wolfSpots: [number, number][] = [
      [620, 460],
      [680, 520],
      [560, 500],
    ];
    for (const [x, y] of wolfSpots) {
      const w = this.spawn("wolf");
      w.add(new Transform({ position: new Vec2(x, y) }));
      w.add(
        new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
          g.roundRect(-13, -8, 26, 16, 5).fill({ color: 0x555566 });
          g.roundRect(-13, -8, 26, 16, 5).stroke({ color: 0xcccccc, width: 1, alpha: 0.6 });
        }),
      );
      w.add(new Wolf({ playerPos, isBusy: busy, onDefeated: () => log.advance("thinThePack", "wolf") }));
    }

    player.add(new PlayerMover(busy));

    // E2E / console handle.
    exposeProbe({ log, inventory, dialogue });
  }

  private drawRoom(): void {
    const bg = this.spawn("room-bg");
    bg.add(new Transform());
    bg.add(
      new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
        g.rect(0, 0, WIDTH, HEIGHT).fill({ color: 0x10101c });
        g.roundRect(16, 90, WIDTH - 32, HEIGHT - 106, 12).fill({ color: 0x181828 });
        g.roundRect(16, 90, WIDTH - 32, HEIGHT - 106, 12).stroke({ color: 0x2c2c4a, width: 2 });
      }),
    );
    const title = this.spawn("room-title");
    title.add(new Transform({ position: new Vec2(WIDTH / 2, 56) }));
    title.add(
      new TextComponent({
        text: "Gather herbs, turn them in, then thin the pack",
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

// ── inspector/e2e probe ─────────────────────────────────────────────────────

interface QuestsProbeHandle {
  readonly log: QuestLog<Defs>;
  readonly inventory: Inventory<"redHerb">;
  readonly dialogue: DialogueController;
}

function exposeProbe(handle: QuestsProbeHandle): void {
  (window as unknown as { __quests__: QuestsProbeHandle }).__quests__ = handle;
}

// ── boot ─────────────────────────────────────────────────────────────────

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
  await engine.start();
  await engine.scenes.push(new QuestsRoomScene());
}

main().catch(console.error);
