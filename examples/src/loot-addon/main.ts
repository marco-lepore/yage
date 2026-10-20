import {
  Component,
  Engine,
  Entity,
  InspectorPlugin,
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
import { Inventory } from "@yagejs-addons/inventory";
import { LootComponent } from "@yagejs-addons/loot";
import { Stats } from "@yagejs-addons/stats";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";
import { ITEMS, TABLES } from "./tables.js";
import type { ChestContext, ItemId } from "./tables.js";

const WIDTH = 960;
const HEIGHT = 650;
const LAYER = "loot-hud";
const BUTTONS = [
  { x: 28, width: 270, label: "OPEN CHEST  [Space]" },
  { x: 320, width: 290, label: "BANK + COLLECT  [B]" },
  { x: 632, width: 300, label: "CHANGE LEVEL  [L]" },
] as const;

class LootDemo extends Component {
  static inspectExclude = ["bag", "bank", "stats", "loot", "view"];
  readonly bag = new Inventory({ catalog: ITEMS, capacity: 2 });
  readonly bank = new Inventory({ catalog: ITEMS });
  readonly stats = new Stats({ level: { base: 1 }, luck: { base: 1 } });
  pending: { item: ItemId; quantity: number; reason: string }[] = [];
  rolls = 0;
  message = "Open a chest. Coins are guaranteed; supplies never repeat.";

  constructor(
    private readonly loot: LootComponent<
      ItemId,
      ChestContext,
      "chest" | "supplies"
    >,
    private readonly view: {
      status: TextComponent;
      bag: TextComponent;
      rewards: TextComponent;
      trace: TextComponent;
    },
  ) {
    super();
  }

  get level(): number {
    return this.stats.get("level");
  }
  get bagItems(): { item: ItemId; quantity: number }[] {
    return this.bag.slots.flatMap((stack) =>
      stack ? [{ item: stack.itemId, quantity: stack.quantity }] : [],
    );
  }
  get bankedQuantity(): number {
    return this.bank.slots.reduce(
      (sum, stack) => sum + (stack?.quantity ?? 0),
      0,
    );
  }
  get pendingQuantity(): number {
    return this.pending.reduce((sum, reward) => sum + reward.quantity, 0);
  }

  onAdd(): void {
    this.addCleanup(
      this.use(InputManagerKey).onPointerDown((pointer) => {
        if (!this.effectiveEnabled || pointer.button !== 0) return;
        const { x, y } = pointer.screenPos;
        if (y < 580 || y > 624) return;
        const selected = BUTTONS.findIndex(
          (button) => x >= button.x && x <= button.x + button.width,
        );
        if (selected === 0) this.openChest();
        if (selected === 1) this.bankAndCollect();
        if (selected === 2) this.changeLevel();
      }),
    );
    this.render();
  }

  update(): void {
    const input = this.use(InputManagerKey);
    if (input.isJustPressed("open")) this.openChest();
    if (input.isJustPressed("bank")) this.bankAndCollect();
    if (input.isJustPressed("level")) this.changeLevel();
  }

  private openChest(): void {
    if (this.pending.length) {
      this.message = "Rewards remain beside the chest. Bank and collect first.";
      this.render();
      return;
    }
    const result = this.loot.roll("chest", {
      level: this.level,
      luck: this.stats.get("luck"),
    });
    this.rolls++;
    this.pending = result.rewards.map(({ item, quantity }) => ({
      item,
      quantity,
      reason: "unclaimed",
    }));
    this.collect();
    this.message = `Chest ${this.rolls}: ${result.rewards.length} reward stacks. ${this.pendingQuantity} units await space.`;
    this.render();
  }

  private collect(): void {
    this.pending = this.pending.flatMap((reward) => {
      const accepted = this.bag.add(reward.item, reward.quantity);
      return accepted.rejected > 0
        ? [
            {
              item: reward.item,
              quantity: accepted.rejected,
              reason: accepted.reason ?? "capacity",
            },
          ]
        : [];
    });
  }

  private bankAndCollect(): void {
    for (const slot of [...this.bag.slots]) {
      if (slot) this.bag.transfer(this.bank, slot.itemId, slot.quantity);
    }
    this.collect();
    this.message = `Banked inventory through transfer(). ${this.pendingQuantity} units remain beside the chest.`;
    this.render();
  }

  private changeLevel(): void {
    const high = this.level === 1;
    this.stats.setBases({ level: high ? 3 : 1, luck: high ? 4 : 1 });
    this.message = high
      ? "Level 3: ruby is eligible, with weight 4 against empty weight 3."
      : "Level 1: ruby is excluded. Open a chest to see the reason.";
    this.render();
  }

  private render(): void {
    this.view.status.setText(
      `LEVEL ${this.level}   /   LUCK ${this.stats.get("luck")}   /   CHESTS ${this.rolls}\n${this.message}`,
    );
    this.view.bag.setText(
      [
        "BACKPACK  /  2 SLOTS",
        ...this.bagItems.map(
          (stack) => `${ITEMS.get(stack.item).name} × ${stack.quantity}`,
        ),
        ...(this.bag.used ? [] : ["Empty"]),
        "",
        `BANK  /  ${this.bankedQuantity} units`,
        "",
        "BESIDE THE CHEST",
        ...this.pending.map(
          (reward) => `${reward.item} × ${reward.quantity} (${reward.reason})`,
        ),
        ...(this.pending.length ? [] : ["Nothing waiting"]),
      ].join("\n"),
    );
    const result = this.loot.lastRoll;
    this.view.rewards.setText(
      result
        ? [
            "LAST REWARDS",
            ...result.rewards.map(
              (reward) => `${reward.item} × ${reward.quantity}`,
            ),
            "",
            `Random draws: ${result.randomDraws}`,
          ].join("\n")
        : "LAST REWARDS\nCoins: 6–9 guaranteed\nTwo unique supplies\nRuby: requires level 3",
    );
    this.view.trace.setText(
      result
        ? [
            "WHY THESE REWARDS?",
            ...result.trace.flatMap((step) => [
              `${step.table}/${step.pool}: ${step.entry ?? step.status}`,
              ...step.candidates
                .filter((c) => c.status === "condition")
                .map((c) => `  ${c.entry}: ${c.reason}`),
              ...step.candidates
                .filter((c) => c.status === "already-selected")
                .map((c) => `  ${c.entry}: already selected`),
            ]),
          ].join("\n")
        : "WHY THESE REWARDS?\nEvery roll records selections,\nconditions and unique exclusions.\n\nThe backpack decides what fits.\nRejected rewards stay here.",
    );
  }
}

class LootDemoEntity extends Entity {
  setup(): void {
    this.add(
      new GraphicsComponent({ layer: LAYER }).draw((g) => {
        g.rect(0, 0, WIDTH, HEIGHT).fill({ color: 0x101722 });
        g.roundRect(22, 110, 280, 440, 12).fill({ color: 0x1b2838 });
        g.roundRect(316, 110, 250, 440, 12).fill({ color: 0x1b2838 });
        g.roundRect(580, 110, 358, 440, 12).fill({ color: 0x1b2838 });
        for (const button of BUTTONS)
          g.roundRect(button.x, 580, button.width, 44, 8).fill({
            color: 0x346b74,
          });
      }),
    );
    const text = (
      name: string,
      x: number,
      y: number,
      size: number,
      content = "",
    ): TextComponent => {
      const child = this.spawnChild(name);
      child.add(new Transform({ position: new Vec2(x, y) }));
      return child.add(
        new TextComponent({
          text: content,
          layer: LAYER,
          anchor: { x: 0, y: 0 },
          style: {
            fontFamily: "monospace",
            fontSize: size,
            fill: 0xe7eef6,
            lineHeight: size + 10,
          },
        }),
      );
    };
    text("title", 28, 20, 26, "LOOT TABLES / THE EXPEDITION CHEST");
    const view = {
      status: text("status", 28, 62, 14),
      bag: text("backpack", 38, 130, 16),
      rewards: text("rewards", 332, 130, 16),
      trace: text("explanation", 596, 130, 13),
    };
    for (const button of BUTTONS)
      text(button.label, button.x + 15, 593, 15, button.label);
    const loot = this.add(new LootComponent(TABLES));
    this.add(new LootDemo(loot, view));
  }
}

class LootScene extends Scene {
  readonly name = "loot-addon";
  readonly layers = [{ name: LAYER, order: 1050, space: "screen" as const }];
  onEnter(): void {
    this.spawn(LootDemoEntity, { key: "loot-demo" });
  }
}

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(new InspectorPlugin());
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      container: setupGameContainer(WIDTH, HEIGHT),
      backgroundColor: 0x101722,
    }),
  );
  engine.use(
    new InputPlugin({
      actions: { open: ["Space"], bank: ["KeyB"], level: ["KeyL"] },
      preventDefaultKeys: ["Space"],
    }),
  );
  await installDebugFromUrl(engine);
  await engine.start();
  await engine.scenes.push(new LootScene());
}
main().catch(console.error);
