import { describe, it, expect } from "vitest";
import {
  createMockEntity,
  createMockScene,
  createTestEngine,
  TestHostPlugin,
} from "./test-utils.js";
import { AssetManager } from "./AssetManager.js";
import { AssetManagerKey, HostKey, LoggerKey } from "./EngineContext.js";
import { Component } from "./Component.js";
import { Host } from "./Host.js";
import { Logger } from "./Logger.js";

describe("TestHostPlugin", () => {
  it("defaults to a test host with no versions", () => {
    expect(new TestHostPlugin().info).toStrictEqual({
      runtime: "test",
      os: "unknown",
    });
  });

  it("takes the fields it is given", () => {
    expect(
      new TestHostPlugin({
        runtime: "capacitor",
        os: "android",
        appVersion: "2.0.1",
        appBuild: "17",
        runtimeVersion: "8.5.3",
      }).info,
    ).toEqual({
      runtime: "capacitor",
      os: "android",
      appVersion: "2.0.1",
      appBuild: "17",
      runtimeVersion: "8.5.3",
    });
  });

  it("attaches on install and detaches on engine destroy", async () => {
    const engine = await createTestEngine(undefined, [
      new TestHostPlugin({ os: "ios" }),
    ]);

    expect(engine.host.info).toMatchObject({ runtime: "test", os: "ios" });

    engine.destroy();

    expect(engine.host.info.runtime).toBe("browser");
  });

  it("does nothing on destroy when it never installed", () => {
    expect(() => new TestHostPlugin().onDestroy()).not.toThrow();
  });

  it("starts the engine with the lifecycle state it was given", async () => {
    const engine = await createTestEngine(undefined, [
      new TestHostPlugin(undefined, { visibility: "hidden" }),
    ]);

    expect(engine.host.lifecycle.visibility).toBe("hidden");
    expect(engine.host.active).toBe(false);

    engine.destroy();
  });

  it("reports a change while installed and only records one after destroy", async () => {
    const fake = new TestHostPlugin();
    fake.setLifecycle({ activity: "active" });
    expect(fake.lifecycle).toEqual({ activity: "active" });

    const engine = await createTestEngine(undefined, [fake]);
    expect(engine.host.lifecycle.activity).toBe("active");

    fake.setLifecycle({ activity: "inactive" });
    expect(engine.host.lifecycle.activity).toBe("inactive");
    expect(engine.host.active).toBe(false);

    engine.destroy();
    expect(() => fake.setLifecycle({ activity: "active" })).not.toThrow();
    expect(fake.lifecycle.activity).toBe("active");
    // The engine's teardown dropped the adapter, so every field falls back to
    // what the page reports.
    expect(engine.host.lifecycle.activity).toBe("unknown");
  });
});

describe("createMockScene", () => {
  it("registers a host", () => {
    const { context } = createMockScene();

    expect(context.resolve(HostKey)).toBeInstanceOf(Host);
  });

  it("registers a logger", () => {
    const { context } = createMockScene();

    expect(context.resolve(LoggerKey)).toBeInstanceOf(Logger);
  });

  it("registers an asset manager", () => {
    const { context } = createMockScene();

    expect(context.resolve(AssetManagerKey)).toBeInstanceOf(AssetManager);
  });

  it("gives each scene its own services", () => {
    const first = createMockScene();
    const second = createMockScene();

    expect(second.context.resolve(HostKey)).not.toBe(
      first.context.resolve(HostKey),
    );
    expect(second.context.resolve(LoggerKey)).not.toBe(
      first.context.resolve(LoggerKey),
    );
    expect(second.context.resolve(AssetManagerKey)).not.toBe(
      first.context.resolve(AssetManagerKey),
    );
  });

  it("lets a component on a mock entity resolve all three", () => {
    class Resolver extends Component {
      readonly resolved: unknown[] = [];

      override onAdd(): void {
        this.resolved.push(
          this.use(HostKey),
          this.use(LoggerKey),
          this.use(AssetManagerKey),
        );
      }
    }

    const { entity } = createMockEntity();

    expect(entity.add(new Resolver()).resolved).toEqual([
      expect.any(Host),
      expect.any(Logger),
      expect.any(AssetManager),
    ]);
  });
});
