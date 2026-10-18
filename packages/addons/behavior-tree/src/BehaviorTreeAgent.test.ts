import { describe, expect, it, vi } from "vitest";
import {
  advanceFrames,
  createMockEntity,
  createTestEngine,
  ErrorBoundaryKey,
  InspectorKey,
  InspectorPlugin,
  Scene,
} from "@yagejs/core";
import { BehaviorTree } from "./core/BehaviorTree.js";
import { behaviorNodes } from "./core/nodes.js";
import { BehaviorTreeAgent } from "./BehaviorTreeAgent.js";

const bt = behaviorNodes<object>();
class TestScene extends Scene {
  readonly name = "behavior-test";
}

describe("BehaviorTreeAgent", () => {
  it.each(["disable", "deactivate", "remove", "destroy"])(
    "cancels on %s and does not run exit twice",
    (operation) => {
      const { entity } = createMockEntity();
      const exit = vi.fn();
      const tree = new BehaviorTree(
        bt.action("move", () => ({ tick: () => "running", exit })),
        {},
      );
      const agent = entity.add(new BehaviorTreeAgent(tree));
      agent.fixedUpdate(1);
      if (operation === "disable") agent.enabled = false;
      if (operation === "deactivate") entity.setActive(false);
      if (operation === "remove") entity.remove(BehaviorTreeAgent);
      if (operation === "destroy") entity.destroy();
      expect(exit).toHaveBeenCalledTimes(1);
      expect(tree.status).toBe("idle");
    },
  );

  it("rejects a runner shared between component owners", () => {
    const { scene } = createMockEntity();
    const tree = new BehaviorTree(bt.wait("wait", 1), {});
    scene.spawn("a").add(new BehaviorTreeAgent(tree));
    expect(() => scene.spawn("b").add(new BehaviorTreeAgent(tree))).toThrow(
      "runner already owned",
    );
  });

  it("supports disabling its entity inside an action without continuing the sequence", () => {
    const { entity } = createMockEntity();
    const next = vi.fn();
    const exit = vi.fn();
    const tree = new BehaviorTree(
      bt.sequence("root", [
        bt.action("stop", () => ({
          tick: () => {
            entity.setActive(false);
            return "success";
          },
          exit,
        })),
        bt.action("next", () => ({ tick: next })),
      ]),
      {},
    );
    const agent = entity.add(new BehaviorTreeAgent(tree));
    agent.fixedUpdate(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    expect(tree.status).toBe("idle");
  });

  it("uses the selected scaled clock, freezes with the scene, restarts after disable and exposes Inspector data", async () => {
    const engine = await createTestEngine({ fixedTimestep: 0.02 }, [
      new InspectorPlugin(),
    ]);
    const scene = new TestScene();
    await engine.scenes.push(scene);
    const host = scene.spawn("agent");
    const deltas: number[] = [];
    const enter = vi.fn();
    const exit = vi.fn();
    const tree = new BehaviorTree(
      bt.action("move", () => ({
        enter,
        tick: (dt) => {
          deltas.push(dt);
          return "running";
        },
        exit,
      })),
      {},
    );
    const agent = host.add(new BehaviorTreeAgent(tree));
    scene.timeScale = 0.5;
    host.timeScale = 0.5;
    advanceFrames(engine, 1, 20);
    expect(deltas).toEqual([0.005]);
    scene.timeScale = 0;
    advanceFrames(engine, 3, 20);
    expect(deltas).toHaveLength(1);
    expect(exit).not.toHaveBeenCalled();
    scene.timeScale = 1;
    agent.enabled = false;
    advanceFrames(engine, 1, 20);
    expect(exit).toHaveBeenCalledTimes(1);
    agent.enabled = true;
    advanceFrames(engine, 1, 20);
    expect(enter).toHaveBeenCalledTimes(2);
    const inspector = engine.context.resolve(InspectorKey);
    expect(
      inspector.getComponentData("agent", "BehaviorTreeAgent"),
    ).toMatchObject({
      status: "running",
      execution: { activePaths: ["move"], lastError: null },
    });
    expect(JSON.stringify(inspector.snapshot())).toContain('"move"');
    await engine.destroy();
  });

  it("attributes callbacks to their node and entity in the existing error boundary", () => {
    const { entity, context } = createMockEntity("enemy");
    const original = new Error("attack failed");
    const tree = new BehaviorTree(
      bt.action("attack", () => ({
        tick: () => {
          throw original;
        },
      })),
      {},
    );
    const agent = entity.add(new BehaviorTreeAgent(tree));
    expect(() => agent.fixedUpdate(1)).toThrow(original);
    expect(
      context.resolve(ErrorBoundaryKey).getCallbackErrors(),
    ).toContainEqual(
      expect.objectContaining({
        kind: "Behavior tree tick",
        event: "attack",
        entity: "enemy",
      }),
    );
  });

  it("ancestor deactivation cancels a child tree and reactivation creates fresh work", () => {
    const { entity: parent } = createMockEntity();
    const child = parent.spawnChild("child");
    const create = vi.fn(() => ({
      tick: () => "running" as const,
      exit: vi.fn(),
    }));
    const tree = new BehaviorTree(bt.action("work", create), {});
    const agent = child.add(new BehaviorTreeAgent(tree));
    agent.fixedUpdate(0.1);
    const activation = create.mock.results[0]!.value;
    parent.setActive(false);
    expect(activation.exit).toHaveBeenCalledExactlyOnceWith({
      status: "cancelled",
      reason: "disabled",
      by: null,
    });
    agent.fixedUpdate(0.1);
    expect(create).toHaveBeenCalledTimes(1);
    parent.setActive(true);
    agent.fixedUpdate(0.1);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("scene pause preserves the running action and resumes without a second entry", async () => {
    const engine = await createTestEngine({ fixedTimestep: 0.02 });
    const scene = new TestScene();
    await engine.scenes.push(scene);
    const enter = vi.fn();
    const tick = vi.fn(() => "running" as const);
    const exit = vi.fn();
    const tree = new BehaviorTree(
      bt.action("work", () => ({ enter, tick, exit })),
      {},
    );
    scene.spawn("worker").add(new BehaviorTreeAgent(tree));
    advanceFrames(engine, 1, 20);
    await engine.scenes.push(new TestScene());
    advanceFrames(engine, 5, 20);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
    await engine.scenes.pop();
    advanceFrames(engine, 1, 20);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(enter).toHaveBeenCalledTimes(1);
    await engine.destroy();
  });

  it("update clock runs only on update", () => {
    const { entity } = createMockEntity();
    const tick = vi.fn(() => "running" as const);
    const agent = entity.add(
      new BehaviorTreeAgent(
        new BehaviorTree(
          bt.action("move", () => ({ tick })),
          {},
        ),
        { clock: "frame" },
      ),
    );
    agent.fixedUpdate(0.1);
    expect(tick).not.toHaveBeenCalled();
    agent.update(0.1);
    expect(tick).toHaveBeenCalledExactlyOnceWith(0.1);
  });
});
