import { afterEach, describe, expect, it } from "vitest";
import { Component } from "./Component.js";
import { Engine } from "./Engine.js";
import { InspectorKey } from "./EngineContext.js";
import { defineEvent } from "./EventToken.js";
import { Inspector } from "./Inspector.js";
import { InspectorPlugin, installInspector } from "./InspectorPlugin.js";
import { Scene } from "./Scene.js";

class TestScene extends Scene {
  readonly name = "test";
}

const Ping = defineEvent<{ n: number }>("test:ping");
const Dropped = defineEvent<undefined>("test:dropped");

/** Emits on the scene from its own teardown, which runs in the destroy flush. */
class DropsOnDestroy extends Component {
  onDestroy(): void {
    this.entity.scene.emit(Dropped, undefined);
  }
}

const engines: Engine[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.destroy();
});

async function start(...plugins: InspectorPlugin[]): Promise<Engine> {
  const engine = new Engine();
  engines.push(engine);
  for (const plugin of plugins) engine.use(plugin);
  await engine.start();
  return engine;
}

describe("InspectorPlugin", () => {
  it("registers an Inspector under InspectorKey", async () => {
    const engine = await start(new InspectorPlugin());
    expect(engine.context.resolve(InspectorKey)).toBeInstanceOf(Inspector);
  });

  it("records a scene's events while the log is on, and stops when the scene exits", async () => {
    const engine = await start(new InspectorPlugin());
    const inspector = engine.context.resolve(InspectorKey);
    inspector.events.setEnabled(true);
    const scene = new TestScene();
    await engine.scenes.push(scene);

    scene.emit(Ping, { n: 1 });
    expect(inspector.events.getLog().map((entry) => entry.type)).toContain(
      "test:ping",
    );

    await engine.scenes.pop();
    inspector.events.clearLog();
    scene.emit(Ping, { n: 2 });
    expect(
      inspector.events.getLog().filter((entry) => entry.type === "test:ping"),
    ).toEqual([]);
  });

  it("expires a waitFor deadline once its frame ends", async () => {
    const engine = await start(new InspectorPlugin());
    const inspector = engine.context.resolve(InspectorKey);
    inspector.events.setEnabled(true);

    const wait = inspector.events.waitFor("test:never", { withinFrames: 1 });
    engine.loop.tick(16);
    await expect(wait).rejects.toThrow("timed out after 1 frames");
  });

  it("counts an event from the destroy flush on the deadline frame", async () => {
    const engine = await start(new InspectorPlugin());
    const inspector = engine.context.resolve(InspectorKey);
    inspector.events.setEnabled(true);
    const scene = new TestScene();
    await engine.scenes.push(scene);
    const entity = scene.spawn("dropper");
    entity.add(new DropsOnDestroy());

    const wait = inspector.events.waitFor("test:dropped", { withinFrames: 1 });
    entity.destroy();
    engine.loop.tick(16);
    await expect(wait).resolves.toMatchObject({ type: "test:dropped" });
  });

  it("reuses an Inspector that is already installed, and only its creator removes it", async () => {
    const plugin = new InspectorPlugin();
    const engine = await start(plugin);
    const inspector = engine.context.resolve(InspectorKey);

    const removeSecond = installInspector(engine.context);
    expect(engine.context.resolve(InspectorKey)).toBe(inspector);
    removeSecond();
    expect(engine.context.resolve(InspectorKey)).toBe(inspector);

    plugin.onDestroy();
    expect(engine.context.has(InspectorKey)).toBe(false);
  });

  it("removes the Inspector when the engine is destroyed, rejecting pending waits", async () => {
    const engine = await start(new InspectorPlugin());
    const inspector = engine.context.resolve(InspectorKey);
    inspector.events.setEnabled(true);
    const wait = inspector.events.waitFor("test:never");

    engine.destroy();
    await expect(wait).rejects.toThrow("Inspector was disposed");
    expect(engine.context.has(InspectorKey)).toBe(false);
  });
});

describe("installInspector", () => {
  it("returns a remover that is safe to call twice", async () => {
    const engine = await start();
    const remove = installInspector(engine.context);
    expect(engine.context.has(InspectorKey)).toBe(true);
    remove();
    remove();
    expect(engine.context.has(InspectorKey)).toBe(false);
  });

  it("stops expiring deadlines once removed", async () => {
    const engine = await start();
    const remove = installInspector(engine.context);
    const inspector = engine.context.resolve(InspectorKey);
    inspector.events.setEnabled(true);
    const wait = inspector.events.waitFor("test:never", { withinFrames: 1 });
    const settled = wait.then(
      () => "resolved",
      (error: Error) => error.message,
    );

    remove();
    engine.loop.tick(16);
    // Disposal rejected the wait; no frame-end expiry ran afterwards.
    await expect(settled).resolves.toContain("Inspector was disposed");
  });
});
