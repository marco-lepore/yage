import { describe, expect, it, vi } from "vitest";
import { createMockScene } from "@yagejs/core";
import { defineQuests } from "./core/catalog.js";
import { QuestLog } from "./core/QuestLog.js";
import { QuestController } from "./QuestController.js";
import {
  QuestChangedEvent,
  QuestCompletedEvent,
  QuestFailedEvent,
  QuestObjectiveProgressChangedEvent,
  QuestObjectiveCompletedEvent,
  QuestStartedEvent,
} from "./events.js";

function herbLog() {
  const catalog = defineQuests({
    gatherHerbs: {
      title: "Gather Herbs",
      objectives: { herb: { title: "Collect red herbs", count: 5 } },
    },
  });
  return new QuestLog(catalog);
}

describe("QuestController", () => {
  it("onAdd mirrors each of the six model events onto the host entity's bus", () => {
    const { scene } = createMockScene();
    const log = herbLog();
    const host = scene.spawn("quest-host");
    host.add(new QuestController({ log }));

    const started = vi.fn();
    const progressChanged = vi.fn();
    const objCompleted = vi.fn();
    const completed = vi.fn();
    const failed = vi.fn();
    const changed = vi.fn();
    host.on(QuestStartedEvent, started);
    host.on(QuestObjectiveProgressChangedEvent, progressChanged);
    host.on(QuestObjectiveCompletedEvent, objCompleted);
    host.on(QuestCompletedEvent, completed);
    host.on(QuestFailedEvent, failed);
    host.on(QuestChangedEvent, changed);

    log.start("gatherHerbs");
    expect(started).toHaveBeenCalledWith({ questId: "gatherHerbs" });
    expect(changed).toHaveBeenCalledWith({ questId: "gatherHerbs" });

    log.advance("gatherHerbs", "herb", 5);
    expect(progressChanged).toHaveBeenCalledWith({
      questId: "gatherHerbs",
      objectiveId: "herb",
      progress: 5,
      count: 5,
      done: true,
    });
    expect(objCompleted).toHaveBeenCalledWith({ questId: "gatherHerbs", objectiveId: "herb" });
    expect(completed).toHaveBeenCalledWith({ questId: "gatherHerbs" });

    const other = herbLog();
    other.start("gatherHerbs");
    other.fail("gatherHerbs");
    // Not mirrored — `other` isn't the hosted log; this just documents that
    // failed only fires for the log this controller actually hosts.
    expect(failed).not.toHaveBeenCalled();
  });

  it("mirrors questFailed from the hosted log onto the entity bus", () => {
    const { scene } = createMockScene();
    const log = herbLog();
    const host = scene.spawn("quest-host");
    host.add(new QuestController({ log }));

    const failed = vi.fn();
    host.on(QuestFailedEvent, failed);

    log.start("gatherHerbs");
    log.fail("gatherHerbs");
    expect(failed).toHaveBeenCalledWith({ questId: "gatherHerbs" });
  });

  it("onDestroy unsubscribes — post-teardown model emits don't reach the bus", () => {
    const { scene } = createMockScene();
    const log = herbLog();
    const host = scene.spawn("quest-host");
    host.add(new QuestController({ log }));

    const changed = vi.fn();
    host.on(QuestChangedEvent, changed);
    host.remove(QuestController);

    log.start("gatherHerbs");
    expect(changed).not.toHaveBeenCalled();
  });

  it(".log returns the hosted model", () => {
    const { scene } = createMockScene();
    const log = herbLog();
    const controller = new QuestController({ log });
    scene.spawn("quest-host").add(controller);
    expect(controller.log).toBe(log);
  });
});
