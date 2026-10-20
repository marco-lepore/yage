import {
  Component,
  Engine,
  Entity,
  InspectorPlugin,
  ProcessComponent,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import type { ProcessSlot } from "@yagejs/core";
import {
  GraphicsComponent,
  RendererPlugin,
  TextComponent,
} from "@yagejs/renderer";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import { Abilities, defineStep } from "@yagejs-addons/abilities";
import { defineItems, Inventory } from "@yagejs-addons/inventory";
import {
  HOTBAR_ACTION_MAP,
  Hotbar,
  HotbarActivationEvent,
  HotbarController,
} from "@yagejs-addons/hotbar";
import type { HotbarSnapshot } from "@yagejs-addons/hotbar";
import {
  HotbarView,
  defaultHotbarTheme,
} from "@yagejs-addons/hotbar/presenters";
import { setupGameContainer } from "../shared/bootstrap.js";

const zap = defineStep<{ damage: number }>("training-zap", {
  fire: (params, ctx) => ctx.entity.get(Training).hit(params.damage),
});
const ZAP = {
  id: "zap",
  duration: 0.3,
  cooldown: 2,
  timeline: [zap({ at: 0, damage: 25 })],
};
const items = defineItems({ potion: { name: "Potion", maxStack: 9 } });

class Training extends Component {
  static inspectExclude = [
    "bag",
    "hotbar",
    "controller",
    "status",
    "art",
    "flash",
    "saved",
  ];
  readonly bag = new Inventory({ catalog: items, capacity: 2 });
  hotbar!: Hotbar<"zap" | "potion" | "restock">;
  controller!: HotbarController<"zap" | "potion" | "restock">;
  health = 45;
  hits = 0;
  message = "Cast Zap or drink a potion.";
  private saved: HotbarSnapshot | undefined;
  private status!: TextComponent;
  private art!: GraphicsComponent;
  private flash!: ProcessSlot;

  get potions(): number {
    return this.bag.count("potion");
  }

  onAdd(): void {
    this.bag.add("potion", 3);
    const abilities = this.entity.get(Abilities);
    this.flash = this.entity.get(ProcessComponent).slot({ duration: 0.2 });
    const label = this.entity.spawnChild("training-status");
    label.add(new Transform({ position: new Vec2(42, 42) }));
    this.status = label.add(
      new TextComponent({
        text: "",
        layer: "hud",
        style: {
          fontFamily: "sans-serif",
          fontSize: 21,
          fill: 0xe4efff,
          lineHeight: 32,
        },
      }),
    );
    const art = this.entity.spawnChild("training-target");
    art.add(new Transform());
    this.art = art.add(new GraphicsComponent({ layer: "hud" }));
    this.hotbar = new Hotbar({
      slotCount: 5,
      slots: ["zap", "potion", "restock"],
      bindings: {
        zap: {
          label: "Zap",
          read: () => ({
            available: abilities.canSend("zap"),
            reason:
              abilities.cooldownRemaining("zap") > 0 ? "cooldown" : "busy",
            cooldown: {
              remaining: abilities.cooldownRemaining("zap"),
              total: 2,
            },
          }),
          activate: () => abilities.send("zap"),
        },
        potion: {
          label: "Potion",
          read: () => ({
            count: this.potions,
            available: this.potions > 0 && this.health < 100,
            reason: this.potions === 0 ? "out of potions" : "health full",
          }),
          activate: () => this.drink(),
        },
        restock: {
          label: "Restock",
          activate: () => {
            this.bag.add("potion", 3);
            this.health = 45;
            return { ok: true };
          },
        },
      },
    });
    this.controller = this.entity.add(
      new HotbarController({
        model: this.hotbar,
        presenter: new HotbarView({
          ...defaultHotbarTheme(),
          slotWidth: 130,
          slotHeight: 100,
        }),
      }),
    );
    this.listen(this.entity, HotbarActivationEvent, (event) => {
      this.message = event.result.ok
        ? `${event.bindingId ?? "Empty"} activated`
        : `Cannot activate: ${event.result.reason}`;
    });
  }

  hit(damage: number): void {
    this.hits++;
    this.message = `Target hit for ${damage}`;
    this.flash.restart();
  }
  private drink(): { ok: true } | { ok: false; reason: string } {
    if (this.health >= 100) return { ok: false, reason: "health full" };
    const result = this.bag.remove("potion", 1);
    if (result.removed === 0) return { ok: false, reason: "out of potions" };
    this.health = Math.min(100, this.health + 20);
    return { ok: true };
  }
  update(): void {
    const input = this.use(InputManagerKey);
    if (input.isJustPressed("assign-potion"))
      this.hotbar.assign(this.hotbar.selection, "potion");
    if (input.isJustPressed("save-bar")) {
      this.saved = this.hotbar.snapshot();
      this.message = "Assignments saved";
    }
    if (input.isJustPressed("restore-bar") && this.saved) {
      this.hotbar.restore(this.saved);
      this.message = "Assignments restored";
    }
    this.status.setText(
      `HOTBAR TRAINING\nHealth ${this.health}/100  ·  Potions ${this.potions}  ·  Target hits ${this.hits}\n${this.message}\n\nP assigns Potion to the selected slot.\nS saves assignments; L restores them.`,
    );
    this.art.draw((g) => {
      g.clear();
      g.circle(620, 285, 40)
        .fill(this.flash.running ? 0x66e3c4 : 0x38516d)
        .stroke({ color: 0x8da8c7, width: 3 });
      g.circle(620, 285, 16).stroke({ color: 0xe4efff, width: 3 });
      if (this.flash.running)
        g.moveTo(180, 320)
          .lineTo(620, 285)
          .stroke({ color: 0x66e3c4, width: 8 });
    });
  }
}

class HotbarHost extends Entity {
  setup(): void {
    this.add(new Transform());
    this.add(new ProcessComponent());
    this.add(new Abilities([ZAP]));
    this.add(new Training());
  }
}
class HotbarScene extends Scene {
  readonly name = "hotbar";
  readonly layers = [{ name: "hud", order: 1000, space: "screen" as const }];
  onEnter(): void {
    this.spawn(HotbarHost, { key: "hotbar-host" });
  }
}
async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(
    new RendererPlugin({
      width: 800,
      height: 500,
      backgroundColor: 0x0c1422,
      container: setupGameContainer(800, 500),
    }),
  );
  engine.use(
    new InputPlugin({
      actions: {
        ...HOTBAR_ACTION_MAP,
        "assign-potion": ["KeyP"],
        "save-bar": ["KeyS"],
        "restore-bar": ["KeyL"],
      },
    }),
  );
  engine.use(new InspectorPlugin());
  await engine.start();
  await engine.scenes.push(new HotbarScene());
}
main().catch(console.error);
