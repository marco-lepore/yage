import { describe, expect, it, vi } from "vitest";
import { defineQuests } from "./catalog.js";
import { QuestLog } from "./QuestLog.js";

function herbLog() {
  const catalog = defineQuests({
    gatherHerbs: {
      title: "Gather Herbs",
      objectives: {
        herb: { title: "Collect red herbs", count: 5 },
        turnIn: { title: "Return to the healer" },
      },
    },
  });
  return new QuestLog(catalog);
}

describe("start", () => {
  it("available -> active: questStarted then changed, { ok: true }", () => {
    const log = herbLog();
    const events: string[] = [];
    log.on("questStarted", () => events.push("questStarted"));
    log.on("changed", () => events.push("changed"));

    const result = log.start("gatherHerbs");
    expect(result).toEqual({ ok: true });
    expect(log.status("gatherHerbs")).toBe("active");
    expect(events).toEqual(["questStarted", "changed"]);
  });

  it("a prereq-locked quest refuses to start with no state change", () => {
    const catalog = defineQuests({
      a: { title: "A", objectives: { step: {} } },
      b: { title: "B", objectives: { step: {} }, requires: ["a"] },
    });
    const log = new QuestLog(catalog);
    const changed = vi.fn();
    log.on("changed", changed);

    expect(log.start("b")).toEqual({ ok: false, reason: "locked" });
    expect(log.status("b")).toBe("locked");
    expect(changed).not.toHaveBeenCalled();
  });

  it("starting twice returns already-active", () => {
    const log = herbLog();
    log.start("gatherHerbs");
    expect(log.start("gatherHerbs")).toEqual({ ok: false, reason: "already-active" });
  });

  it("starting a completed quest returns already-completed", () => {
    const log = herbLog();
    log.start("gatherHerbs");
    log.forceCompleteQuest("gatherHerbs");
    expect(log.start("gatherHerbs")).toEqual({ ok: false, reason: "already-completed" });
  });

  it("an unknown quest id returns unknown-quest without throwing", () => {
    const log = herbLog();
    expect(log.start("nope" as never)).toEqual({ ok: false, reason: "unknown-quest" });
  });
});

describe("advance / setProgress / complete", () => {
  it("advance bumps and clamps to target, emitting objectiveProgressChanged", () => {
    const log = herbLog();
    log.start("gatherHerbs");
    const advanced: { progress: number; count: number; done: boolean }[] = [];
    log.on("objectiveProgressChanged", (e) => advanced.push(e));

    log.advance("gatherHerbs", "herb", 2);
    expect(advanced).toEqual([
      { questId: "gatherHerbs", objectiveId: "herb", progress: 2, count: 5, done: false },
    ]);
    expect(log.progress("gatherHerbs", "herb")).toBe(2);
  });

  it("reaching the target emits objectiveCompleted", () => {
    const log = herbLog();
    log.start("gatherHerbs");
    const completed = vi.fn();
    log.on("objectiveCompleted", completed);

    log.advance("gatherHerbs", "herb", 5);
    expect(completed).toHaveBeenCalledWith({ questId: "gatherHerbs", objectiveId: "herb" });
  });

  it("advancing past the target does not overshoot", () => {
    const log = herbLog();
    log.start("gatherHerbs");
    log.advance("gatherHerbs", "herb", 999);
    expect(log.progress("gatherHerbs", "herb")).toBe(5);
  });

  it("advancing an already-maxed objective emits nothing (quest still active)", () => {
    const log = herbLog();
    log.start("gatherHerbs");
    log.advance("gatherHerbs", "herb", 5); // reaches the target
    const advanced = vi.fn();
    const changed = vi.fn();
    log.on("objectiveProgressChanged", advanced);
    log.on("changed", changed);

    log.advance("gatherHerbs", "herb", 1); // surplus pickup past the target

    expect(advanced).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(log.progress("gatherHerbs", "herb")).toBe(5);
  });

  it("advance/setProgress/complete on a NON-active quest is a silent no-op", () => {
    const log = herbLog();
    // never started -> locked/available, not active
    const advanced = vi.fn();
    const changed = vi.fn();
    log.on("objectiveProgressChanged", advanced);
    log.on("changed", changed);

    log.advance("gatherHerbs", "herb");
    log.setProgress("gatherHerbs", "herb", 3);
    log.complete("gatherHerbs", "turnIn");

    expect(advanced).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(log.progress("gatherHerbs", "herb")).toBe(0);
  });

  it("setProgress sets an absolute value clamped to [0, target] and can decrease", () => {
    const log = herbLog();
    log.start("gatherHerbs");
    log.setProgress("gatherHerbs", "herb", 4);
    expect(log.progress("gatherHerbs", "herb")).toBe(4);
    log.setProgress("gatherHerbs", "herb", 1);
    expect(log.progress("gatherHerbs", "herb")).toBe(1);
    log.setProgress("gatherHerbs", "herb", 999);
    expect(log.progress("gatherHerbs", "herb")).toBe(5);
    log.setProgress("gatherHerbs", "herb", -10);
    expect(log.progress("gatherHerbs", "herb")).toBe(0);
  });

  it("complete drives an objective straight to its target", () => {
    const log = herbLog();
    log.start("gatherHerbs");
    log.complete("gatherHerbs", "herb");
    expect(log.progress("gatherHerbs", "herb")).toBe(5);
    expect(log.objectiveDone("gatherHerbs", "herb")).toBe(true);
  });

  it("an unknown objective id throws", () => {
    const log = herbLog();
    log.start("gatherHerbs");
    expect(() => log.advance("gatherHerbs", "nope" as never)).toThrow(/unknown objective id/);
  });
});

describe("auto-complete rollup", () => {
  it("completing the last non-optional objective auto-transitions to completed, questCompleted after the objective event", () => {
    const log = herbLog();
    log.start("gatherHerbs");
    log.complete("gatherHerbs", "herb");

    const order: string[] = [];
    log.on("objectiveCompleted", () => order.push("objectiveCompleted"));
    log.on("questCompleted", () => order.push("questCompleted"));
    log.on("changed", () => order.push("changed"));

    log.complete("gatherHerbs", "turnIn");
    expect(order).toEqual(["objectiveCompleted", "questCompleted", "changed"]);
    expect(log.status("gatherHerbs")).toBe("completed");
  });

  it("a quest with an incomplete optional objective still completes when required objectives are done", () => {
    const catalog = defineQuests({
      q: {
        title: "Q",
        objectives: {
          required: { title: "Required" },
          bonus: { title: "Bonus", optional: true },
        },
      },
    });
    const log = new QuestLog(catalog);
    log.start("q");
    log.complete("q", "required");
    expect(log.status("q")).toBe("completed");
    expect(log.progress("q", "bonus")).toBe(0);
  });

  it("autoComplete false keeps a ready quest active and lets an objective reopen", () => {
    const catalog = defineQuests({
      bringWood: {
        title: "Bring Wood",
        autoComplete: false,
        objectives: { wood: { count: 10 } },
      },
    });
    const log = new QuestLog(catalog);
    const completed = vi.fn();
    const progressChanged = vi.fn();
    log.on("objectiveCompleted", completed);
    log.on("objectiveProgressChanged", progressChanged);
    log.start("bringWood");

    log.setProgress("bringWood", "wood", 10);
    expect(log.status("bringWood")).toBe("active");
    expect(log.canComplete("bringWood")).toBe(true);

    log.setProgress("bringWood", "wood", 9);
    expect(log.objectiveDone("bringWood", "wood")).toBe(false);
    expect(log.canComplete("bringWood")).toBe(false);
    expect(progressChanged).toHaveBeenLastCalledWith({
      questId: "bringWood",
      objectiveId: "wood",
      progress: 9,
      count: 10,
      done: false,
    });

    log.setProgress("bringWood", "wood", 10);
    expect(log.canComplete("bringWood")).toBe(true);
    expect(completed).toHaveBeenCalledTimes(2);
  });

  it("completeQuest completes only an active quest whose required objectives are done", () => {
    const catalog = defineQuests({
      q: { title: "Q", autoComplete: false, objectives: { step: {} } },
    });
    const log = new QuestLog(catalog);
    const completed = vi.fn();
    log.on("questCompleted", completed);

    log.completeQuest("q");
    log.start("q");
    log.completeQuest("q");
    expect(log.status("q")).toBe("active");
    expect(completed).not.toHaveBeenCalled();

    log.complete("q", "step");
    log.completeQuest("q");
    expect(log.status("q")).toBe("completed");
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it("canComplete ignores optional objectives and is false outside the active phase", () => {
    const catalog = defineQuests({
      q: {
        title: "Q",
        autoComplete: false,
        objectives: { required: {}, bonus: { optional: true } },
      },
    });
    const log = new QuestLog(catalog);
    expect(log.canComplete("q")).toBe(false);
    log.start("q");
    expect(log.canComplete("q")).toBe(false);
    log.complete("q", "required");
    expect(log.canComplete("q")).toBe(true);
    log.completeQuest("q");
    expect(log.canComplete("q")).toBe(false);
  });

  it("forceCompleteQuest marks every objective done and emits questCompleted once", () => {
    const log = herbLog();
    const completed = vi.fn();
    log.on("questCompleted", completed);

    log.forceCompleteQuest("gatherHerbs");
    expect(completed).toHaveBeenCalledTimes(1);
    expect(log.status("gatherHerbs")).toBe("completed");
    expect(log.progress("gatherHerbs", "herb")).toBe(5);
    expect(log.progress("gatherHerbs", "turnIn")).toBe(1);
  });

  it("forceCompleteQuest completes an available quest without questStarted", () => {
    const log = herbLog();
    const started = vi.fn();
    const completed = vi.fn();
    log.on("questStarted", started);
    log.on("questCompleted", completed);

    log.forceCompleteQuest("gatherHerbs");
    expect(started).not.toHaveBeenCalled();
    expect(completed).toHaveBeenCalledTimes(1);
    expect(log.status("gatherHerbs")).toBe("completed");
  });

  it("forceCompleteQuest on an unknown quest id is a silent no-op", () => {
    const log = herbLog();
    const completed = vi.fn();
    const changed = vi.fn();
    log.on("questCompleted", completed);
    log.on("changed", changed);

    expect(() => log.forceCompleteQuest("nope" as never)).not.toThrow();
    expect(completed).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });
});

describe("fail", () => {
  it("active or available -> failed, emits questFailed", () => {
    const log = herbLog();
    const failed = vi.fn();
    log.on("questFailed", failed);
    log.fail("gatherHerbs"); // available -> failed
    expect(failed).toHaveBeenCalledTimes(1);
    expect(log.status("gatherHerbs")).toBe("failed");
  });

  it("fail on an unknown quest id is a silent no-op", () => {
    const log = herbLog();
    const failed = vi.fn();
    log.on("questFailed", failed);

    expect(() => log.fail("nope" as never)).not.toThrow();
    expect(failed).not.toHaveBeenCalled();
  });

  it("further advance/complete on a failed quest is a no-op", () => {
    const log = herbLog();
    log.start("gatherHerbs");
    log.fail("gatherHerbs");
    log.advance("gatherHerbs", "herb");
    expect(log.progress("gatherHerbs", "herb")).toBe(0);
  });

  it("fail on an already-terminal quest is a no-op", () => {
    const log = herbLog();
    log.start("gatherHerbs");
    log.forceCompleteQuest("gatherHerbs");
    const failed = vi.fn();
    log.on("questFailed", failed);
    log.fail("gatherHerbs");
    expect(failed).not.toHaveBeenCalled();
    expect(log.status("gatherHerbs")).toBe("completed");
  });
});

describe("prereq chain + status", () => {
  function chain() {
    const catalog = defineQuests({
      a: { title: "A", objectives: { step: {} } },
      b: { title: "B", objectives: { step: {} }, requires: ["a"] },
    });
    return new QuestLog(catalog);
  }

  it("B is locked until A completes, then available", () => {
    const log = chain();
    expect(log.status("b")).toBe("locked");
    log.start("a");
    expect(log.status("b")).toBe("locked");
    log.complete("a", "step");
    expect(log.status("b")).toBe("available");
  });

  it("start(b) is refused while a is incomplete", () => {
    const log = chain();
    expect(log.start("b")).toEqual({ ok: false, reason: "locked" });
  });

  it("available/active/completed list ids in authoring order", () => {
    const catalog = defineQuests({
      c: { title: "C", objectives: { step: {} } },
      a: { title: "A", objectives: { step: {} } },
      b: { title: "B", objectives: { step: {} } },
    });
    const log = new QuestLog(catalog);
    log.start("a");
    log.forceCompleteQuest("b");
    expect(log.available()).toEqual(["c"]);
    expect(log.active()).toEqual(["a"]);
    expect(log.completed()).toEqual(["b"]);
  });
});

describe("snapshot / restore", () => {
  it("round-trips phases and objective counts", () => {
    const log = herbLog();
    log.start("gatherHerbs");
    log.advance("gatherHerbs", "herb", 3);

    const snap = log.snapshot();
    const restored = herbLog();
    restored.restore(snap);
    expect(restored.status("gatherHerbs")).toBe("active");
    expect(restored.progress("gatherHerbs", "herb")).toBe(3);
  });

  it("drops unknown quest ids and unknown objective ids, clamping counts to current targets", () => {
    const log = herbLog();
    log.restore({
      quests: {
        gatherHerbs: { phase: "active", objectives: { herb: 999, ghost: 3 } },
        unknownQuest: { phase: "active", objectives: {} },
      },
    });
    expect(log.status("gatherHerbs")).toBe("active");
    expect(log.progress("gatherHerbs", "herb")).toBe(5); // clamped to target
    // "unknownQuest" isn't in the catalog, so it never entered runtime state —
    // it's simply absent from every derived id list.
    expect(log.available()).not.toContain("unknownQuest");
    expect(log.active()).not.toContain("unknownQuest");
  });

  it("a restored not-started quest re-derives locked/available from requires", () => {
    const catalog = defineQuests({
      a: { title: "A", objectives: { step: {} } },
      b: { title: "B", objectives: { step: {} }, requires: ["a"] },
    });
    const log = new QuestLog(catalog);
    log.restore({ quests: { a: { phase: "completed", objectives: {} } } });
    expect(log.status("b")).toBe("available");
  });

  it("emits a coarse changed for each restored quest", () => {
    const log = herbLog();
    const changed = vi.fn();
    log.on("changed", changed);
    log.restore({
      quests: { gatherHerbs: { phase: "active", objectives: { herb: 1 } } },
    });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith({ questId: "gatherHerbs" });
  });

  it("a blob whose quests isn't a plain object throws and leaves prior state intact", () => {
    const log = herbLog();
    log.start("gatherHerbs");
    log.advance("gatherHerbs", "herb", 3);

    expect(() => log.restore({} as never)).toThrow(/snapshot\.quests must be a plain object/);
    expect(log.status("gatherHerbs")).toBe("active");
    expect(log.progress("gatherHerbs", "herb")).toBe(3);
  });

  it("a non-finite objective count (NaN or a non-numeric value) is skipped, reading back as 0", () => {
    const log = herbLog();
    log.restore({
      quests: {
        gatherHerbs: {
          phase: "active",
          objectives: { herb: NaN, turnIn: "3" as unknown as number },
        },
      },
    });
    expect(log.progress("gatherHerbs", "herb")).toBe(0);
    expect(log.progress("gatherHerbs", "turnIn")).toBe(0);
  });

  it("a fractional objective count is truncated", () => {
    const log = herbLog();
    log.restore({
      quests: { gatherHerbs: { phase: "active", objectives: { herb: 2.9 } } },
    });
    expect(log.progress("gatherHerbs", "herb")).toBe(2);
  });

  it("an unrecognized phase drops the quest entry, same as an unknown quest id", () => {
    const log = herbLog();
    log.restore({
      quests: {
        gatherHerbs: { phase: "in-progress" as never, objectives: { herb: 3 } },
      },
    });
    expect(log.status("gatherHerbs")).toBe("available");
    expect(log.progress("gatherHerbs", "herb")).toBe(0);
  });

  it("a known quest id mapping to a non-object entry is dropped, not thrown on", () => {
    const log = herbLog();
    log.start("gatherHerbs");
    log.restore({
      quests: { gatherHerbs: null as never },
    });
    expect(log.status("gatherHerbs")).toBe("available"); // dropped; log otherwise restored empty
  });

  it("an entry whose objectives isn't a plain object is dropped, not thrown on", () => {
    const log = herbLog();
    log.restore({
      quests: {
        gatherHerbs: { phase: "active", objectives: null as never },
      },
    });
    expect(log.status("gatherHerbs")).toBe("available");
  });
});
