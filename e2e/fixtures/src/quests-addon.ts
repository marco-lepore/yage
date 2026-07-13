/**
 * Deterministic e2e fixture for @yagejs-addons/quests.
 *
 * No player, no dialogue box — the quest log and its binding to inventory are
 * entirely headless, so the fixture boots a bare scene, exposes a `QuestLog`
 * and an `@yagejs-addons/inventory` `Inventory` on `window.__quests__`, and
 * wires the exact one-line adapter the addon is built for
 * (`inventory.on("itemAdded", …) -> log.advance(...)`). The spec drives the
 * model directly and asserts on it — the same surface a journal/tracker HUD
 * would read.
 */

import { Engine, Scene, Vec2 } from "@yagejs/core";
import { RendererPlugin, CameraEntity } from "@yagejs/renderer";
import { DebugPlugin } from "@yagejs/debug";
import { defineItems, Inventory } from "@yagejs-addons/inventory";
import { defineQuests, QuestLog } from "@yagejs-addons/quests";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();

const WIDTH = 800;
const HEIGHT = 600;
const container = setupContainer(WIDTH, HEIGHT);

const QUESTS = defineQuests({
  gatherHerbs: {
    title: "Gather Herbs",
    objectives: {
      herb: { title: "Collect red herbs", count: 5 },
      turnIn: { title: "Return to the healer" },
    },
  },
  thinThePack: {
    title: "Thin the Pack",
    requires: ["gatherHerbs"],
    objectives: { wolf: { title: "Defeat wolves", count: 3 } },
  },
});

const ITEMS = defineItems({ redHerb: { name: "Red Herb", maxStack: 10 } });

class QuestsScene extends Scene {
  readonly name = "quests-e2e";
  readonly layers = [];

  onEnter(): void {
    this.spawn(CameraEntity, { position: new Vec2(WIDTH / 2, HEIGHT / 2) });

    const log = new QuestLog(QUESTS);
    const inventory = new Inventory({ catalog: ITEMS });

    // The binding under test: a game-authored one-liner, no active-state
    // guard, no addon dependency (inventory's model event -> the quest log).
    inventory.on("itemAdded", (e) => {
      if (e.itemId === "redHerb") log.advance("gatherHerbs", "herb", e.quantity);
    });
    log.on("questCompleted", ({ questId }) => {
      if (questId === "gatherHerbs") log.start("thinThePack");
    });

    (window as unknown as { __quests__: unknown }).__quests__ = { log, inventory };
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
engine.use(new DebugPlugin());
await engine.start();
engine.inspector.time.freeze();
await engine.scenes.push(new QuestsScene());
