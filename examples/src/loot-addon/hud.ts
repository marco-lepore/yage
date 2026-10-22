import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import { InputManagerKey } from "@yagejs/input";
import type { LootTrace } from "@yagejs-addons/loot";
import type { AdventurerEntity } from "./adventurer.js";
import type { ChestEntity } from "./chest.js";
import {
  BUTTON_HEIGHT,
  BUTTON_Y,
  BUTTONS,
  HUD_LAYER,
  PANEL_LAYER,
} from "./constants.js";
import type { ButtonAction } from "./constants.js";
import { ITEMS } from "./tables.js";

/** The HUD texts `LootHud` writes to. */
interface HudTexts {
  status: TextComponent;
  inventory: TextComponent;
  rewards: TextComponent;
  explanation: TextComponent;
}

/** One line per pool decision, plus the reason for each excluded entry. */
function explain(step: LootTrace): string[] {
  let outcome: string = step.status;
  if (step.status === "selected") {
    const chance = step.candidates.find((c) => c.entry === step.entry)!;
    outcome = `${step.entry} (${Math.round(chance.probability * 100)}%)`;
  }
  return [
    `${step.table}/${step.pool}: ${outcome}`,
    ...step.candidates.flatMap((candidate) => {
      if (candidate.status === "condition")
        return [`  ${candidate.entry}: ${candidate.reason}`];
      if (candidate.status === "already-selected")
        return [`  ${candidate.entry}: already selected`];
      return [];
    }),
  ];
}

/**
 * Buttons, keys and the three panels. The HUD turns buttons and keys into
 * calls on the chest and the adventurer, which hold the rules, and shows the
 * result.
 */
export class LootHud extends Component {
  static inspectExclude = ["texts", "chestEntity", "adventurerEntity"];
  private readonly input = this.service(InputManagerKey);
  private _message =
    "Open a chest. Coins are guaranteed; supplies never repeat in one chest.";

  constructor(
    private readonly texts: HudTexts,
    private readonly chestEntity: ChestEntity,
    private readonly adventurerEntity: AdventurerEntity,
  ) {
    super();
  }

  get message(): string {
    return this._message;
  }

  onAdd(): void {
    this.addCleanup(
      this.input.onPointerDown((pointer) => {
        if (!this.effectiveEnabled || pointer.button !== 0) return;
        const { x, y } = pointer.screenPos;
        if (y < BUTTON_Y || y > BUTTON_Y + BUTTON_HEIGHT) return;
        const button = BUTTONS.find(
          (candidate) => x >= candidate.x && x <= candidate.x + candidate.width,
        );
        if (button) this.press(button.action);
      }),
    );
    this.refresh();
  }

  update(): void {
    if (this.input.isJustPressed("open")) this.press("open");
    if (this.input.isJustPressed("bank")) this.press("bank");
    if (this.input.isJustPressed("level")) this.press("level");
  }

  private press(action: ButtonAction): void {
    const { chest } = this.chestEntity;
    const { adventurer } = this.adventurerEntity;
    if (action === "open") {
      const result = chest.open(adventurer);
      this._message = result
        ? `Chest ${chest.opened}: ${result.rewards.length} reward stacks. ${chest.waitingQuantity} units wait beside it.`
        : "Rewards still wait beside the chest. Bank and collect first.";
    } else if (action === "bank") {
      adventurer.bankAll();
      chest.collect(adventurer);
      this._message = `Banked the backpack. ${chest.waitingQuantity} units still wait beside the chest.`;
    } else {
      adventurer.toggleLevel();
      this._message =
        adventurer.level === 3
          ? "Level 3: the ruby is eligible. Its weight is the adventurer's luck."
          : "Level 1: the ruby is excluded. Open a chest to see the reason.";
    }
    this.refresh();
  }

  private refresh(): void {
    const { chest, loot } = this.chestEntity;
    const { adventurer } = this.adventurerEntity;
    const crown = adventurer.found.includes("crown")
      ? "found"
      : `${adventurer.misses} misses`;
    this.texts.status.setText(
      `LEVEL ${adventurer.level}   /   LUCK ${adventurer.stats.get("luck")}   /   CHESTS ${chest.opened}   /   CROWN ${crown}\n${this._message}`,
    );
    this.texts.inventory.setText(
      [
        "BACKPACK  /  2 SLOTS",
        ...adventurer.backpackItems.map(
          (stack) => `${ITEMS.get(stack.item).name} × ${stack.quantity}`,
        ),
        ...(adventurer.backpack.used ? [] : ["Empty"]),
        "",
        `BANK  /  ${adventurer.bankedQuantity} units`,
        "",
        "BESIDE THE CHEST",
        ...chest.waiting.map(
          (reward) =>
            `${ITEMS.get(reward.item).name} × ${reward.quantity} (${reward.reason})`,
        ),
        ...(chest.waiting.length ? [] : ["Nothing waiting"]),
      ].join("\n"),
    );
    const result = loot.lastRoll;
    this.texts.rewards.setText(
      result
        ? [
            "LAST REWARDS",
            ...result.rewards.map(
              (reward) => `${ITEMS.get(reward.item).name} × ${reward.quantity}`,
            ),
            "",
            `Random draws: ${result.randomDraws}`,
          ].join("\n")
        : "LAST REWARDS\nCoins: guaranteed\nTwo different supplies\nRuby: level 3 and luck\nCrown: once, odds grow\nwith every miss",
    );
    this.texts.explanation.setText(
      result
        ? ["WHY THESE REWARDS?", ...result.trace.flatMap(explain)].join("\n")
        : "WHY THESE REWARDS?\nEvery roll records its selections,\nconditions and unique exclusions.\n\nThe backpack decides what fits.\nRefused rewards wait beside\nthe chest.",
    );
  }
}

/** Panels, buttons and texts for one chest and the adventurer opening it. */
export class HudEntity extends Entity {
  hud!: LootHud;

  setup(params: { chest: ChestEntity; adventurer: AdventurerEntity }): void {
    this.add(
      new GraphicsComponent({ layer: PANEL_LAYER }).draw((g) => {
        g.roundRect(22, 110, 280, 440, 12).fill({ color: 0x1b2838 });
        g.roundRect(316, 110, 250, 440, 12).fill({ color: 0x1b2838 });
        g.roundRect(580, 110, 358, 440, 12).fill({ color: 0x1b2838 });
        for (const button of BUTTONS)
          g.roundRect(button.x, BUTTON_Y, button.width, BUTTON_HEIGHT, 8).fill({
            color: 0x346b74,
          });
      }),
    );
    this.text("title", 28, 20, 26, "LOOT TABLES / THE EXPEDITION CHEST");
    for (const button of BUTTONS)
      this.text(button.action, button.x + 15, BUTTON_Y + 13, 15, button.label);
    this.hud = this.add(
      new LootHud(
        {
          status: this.text("status", 28, 62, 14),
          inventory: this.text("inventory", 38, 130, 16),
          rewards: this.text("rewards", 332, 230, 16),
          explanation: this.text("explanation", 596, 130, 13),
        },
        params.chest,
        params.adventurer,
      ),
    );
  }

  /** One block of text as a child entity, positioned in screen pixels. */
  private text(
    name: string,
    x: number,
    y: number,
    size: number,
    content = "",
  ): TextComponent {
    const child = this.spawnChild(name);
    child.add(new Transform({ position: new Vec2(x, y) }));
    return child.add(
      new TextComponent({
        text: content,
        layer: HUD_LAYER,
        anchor: { x: 0, y: 0 },
        style: {
          fontFamily: "monospace",
          fontSize: size,
          fill: 0xe7eef6,
          lineHeight: size + 10,
        },
      }),
    );
  }
}
