import { describe, expect, it, vi } from "vitest";
import {
  advanceFrames,
  createMockEntity,
  createTestEngine,
  ErrorBoundaryKey,
  InspectorKey,
  InspectorPlugin,
  RandomKey,
  Scene,
} from "@yagejs/core";
import { behaviorNodes } from "./core/nodes.js";
import { BehaviorTreeAgent } from "./BehaviorTreeAgent.js";

const bt = behaviorNodes<object>();
class TestScene extends Scene {
  readonly name = "behavior-test";
}

describe("BehaviorTreeAgent", () => {
  it("uses scene randomness and preserves an explicitly injected source", () => {
    const { entity } = createMockEntity();
    const random = vi
      .spyOn(entity.scene.use(RandomKey), "float")
      .mockReturnValue(0.25);
    const agent = entity.add(
      new BehaviorTreeAgent(bt.randomWait("wait", 0, 4), {}),
    );
    agent.fixedUpdate(0.5);
    expect(random).toHaveBeenCalledTimes(1);
    expect(agent.execution.nodes[0]?.durationSeconds).toBe(1);
    const explicit = vi.fn(() => 0.75);
    const second = entity
      .spawnChild("other")
      .add(
        new BehaviorTreeAgent(
          bt.randomWait("wait", 0, 4),
          {},
          { random: explicit },
        ),
      );
    second.fixedUpdate(0.5);
    expect(explicit).toHaveBeenCalledTimes(1);
    expect(random).toHaveBeenCalledTimes(1);
    expect(second.execution.nodes[0]?.durationSeconds).toBe(3);
  });

  it("builds its runner when added and validates the definition there", () => {
    const agent = new BehaviorTreeAgent(bt.wait("rest", 1), {});
    expect(() => agent.tree).toThrow("add the agent to an entity first");
    const { entity } = createMockEntity();
    expect(() =>
      entity
        .spawnChild("invalid")
        .add(new BehaviorTreeAgent(bt.wait("bad/id", 1), {})),
    ).toThrow("node id");
    const shared = bt.wait("rest", 1);
    const a = entity.add(new BehaviorTreeAgent(shared, {}));
    const b = entity.spawnChild("b").add(new BehaviorTreeAgent(shared, {}));
    a.fixedUpdate(0.5);
    expect(a.status).toBe("running");
    expect(b.status).toBe("idle");
  });

  it("disabling freezes an armed cooldown and re-enabling cannot bypass it", async () => {
    const engine = await createTestEngine({ fixedTimestep: 0.25 });
    const scene = new TestScene();
    await engine.scenes.push(scene);
    const fire = vi.fn(() => "success" as const);
    const agent = scene.spawn("gun").add(
      new BehaviorTreeAgent(
        bt.cooldown(
          "limit",
          0.5,
          bt.action("fire", () => ({ tick: fire })),
        ),
        {},
      ),
    );
    advanceFrames(engine, 1, 250);
    agent.enabled = false;
    advanceFrames(engine, 8, 250);
    expect(agent.execution.nodes[0]?.remainingSeconds).toBe(0.5);
    agent.enabled = true;
    advanceFrames(engine, 1, 250);
    expect(agent.status).toBe("failure");
    expect(fire).toHaveBeenCalledTimes(1);
    advanceFrames(engine, 1, 250);
    expect(fire).toHaveBeenCalledTimes(2);
    await engine.destroy();
  });

  it.each(["disable", "deactivate", "remove", "destroy"])(
    "cancels on %s with reason disabled and does not run exit twice",
    (operation) => {
      const { entity } = createMockEntity();
      const exit = vi.fn();
      const agent = entity.add(
        new BehaviorTreeAgent(
          bt.action("move", () => ({ tick: () => "running", exit })),
          {},
        ),
      );
      agent.fixedUpdate(1);
      if (operation === "disable") agent.enabled = false;
      if (operation === "deactivate") entity.setActive(false);
      if (operation === "remove") entity.remove(BehaviorTreeAgent);
      if (operation === "destroy") entity.destroy();
      expect(exit).toHaveBeenCalledExactlyOnceWith({
        status: "cancelled",
        reason: "disabled",
        by: null,
      });
      expect(agent.status).toBe("idle");
    },
  );

  it("supports disabling its entity inside an action without continuing the sequence", () => {
    const { entity } = createMockEntity();
    const next = vi.fn();
    const exit = vi.fn();
    const agent = entity.add(
      new BehaviorTreeAgent(
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
      ),
    );
    agent.fixedUpdate(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    expect(agent.status).toBe("idle");
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
    const agent = host.add(
      new BehaviorTreeAgent(
        bt.action("move", () => ({
          enter,
          tick: (dt) => {
            deltas.push(dt);
            return "running";
          },
          exit,
        })),
        {},
      ),
    );
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

  it("attributes callbacks to their node, entity and scene in the existing error boundary", () => {
    const { entity, context } = createMockEntity("enemy");
    const original = new Error("attack failed");
    const agent = entity.add(
      new BehaviorTreeAgent(
        bt.action("attack", () => ({
          tick: () => {
            throw original;
          },
        })),
        {},
      ),
    );
    expect(() => agent.fixedUpdate(1)).toThrow(original);
    expect(
      context.resolve(ErrorBoundaryKey).getCallbackErrors(),
    ).toContainEqual(
      expect.objectContaining({
        kind: "Behavior tree tick",
        event: "attack",
        entity: "enemy",
        scene: entity.scene.name,
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
    const agent = child.add(
      new BehaviorTreeAgent(bt.action("work", create), {}),
    );
    agent.fixedUpdate(0.1);
    const activation = create.mock.results[0]!.value;
    parent.setActive(false);
    expect(activation.exit).toHaveBeenCalledExactlyOnceWith({
      status: "cancelled",
      reason: "disabled",
      by: null,
    });
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
    scene.spawn("worker").add(
      new BehaviorTreeAgent(
        bt.action("work", () => ({ enter, tick, exit })),
        {},
      ),
    );
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

  it('clock: "frame" ticks only in update', () => {
    const { entity } = createMockEntity();
    const tick = vi.fn(() => "running" as const);
    const agent = entity.add(
      new BehaviorTreeAgent(
        bt.action("move", () => ({ tick })),
        {},
        { clock: "frame" },
      ),
    );
    agent.fixedUpdate(0.1);
    expect(tick).not.toHaveBeenCalled();
    agent.update(0.1);
    expect(tick).toHaveBeenCalledExactlyOnceWith(0.1);
  });
});
