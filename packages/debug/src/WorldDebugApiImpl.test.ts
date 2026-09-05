import { afterEach, describe, expect, it, vi } from "vitest";
import { Container } from "pixi.js";
import { Engine, Scene, Transform, Vec2, ErrorBoundaryKey } from "@yagejs/core";
import {
  CameraComponent,
  RendererKey,
  SceneRenderTreeKey,
} from "@yagejs/renderer";
import type {
  SceneRenderTree,
  SceneRenderTreeProvider,
} from "@yagejs/renderer";
import { WorldDebugApiImpl } from "./WorldDebugApiImpl.js";
import { GraphicsPool } from "./GraphicsPool.js";
import { DebugRegistryImpl } from "./DebugRegistryImpl.js";
import { VectorContributor } from "./contributors/VectorContributor.js";
import { DebugRenderSystem } from "./DebugRenderSystem.js";
import { HudDebugApiImpl } from "./HudDebugApiImpl.js";
import { TextPool } from "./TextPool.js";
import { StatsStore } from "./StatsStore.js";

const engines: Engine[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.destroy();
});
class TestScene extends Scene {
  readonly name = "world";
  override readonly transparentBelow = true;
}

async function setup(cap = 8) {
  const engine = new Engine({ logger: { output: () => {} } });
  engines.push(engine);
  engine.context.register(RendererKey, {
    virtualSize: { width: 640, height: 360 },
  } as never);
  const root = new Container();
  const pool = new GraphicsPool(root, cap);
  const registry = new DebugRegistryImpl();
  registry.enabled = true;
  const provider = {
    getTree: (scene: Scene) => scene._resolveScoped(SceneRenderTreeKey),
  } as SceneRenderTreeProvider;
  const api = new WorldDebugApiImpl(
    pool,
    registry,
    engine.scenes,
    provider,
    root,
  );
  engine.registerSceneHooks({
    beforeEnter: (scene) =>
      scene._registerScoped(SceneRenderTreeKey, {
        root: new Container(),
      } as SceneRenderTree),
    afterExit: (scene) => api.releaseScene(scene),
  });
  await engine.start();
  const bottom = new TestScene();
  const top = new TestScene();
  await engine.scenes.push(bottom);
  await engine.scenes.push(top);
  const lowerCamera = bottom
    .spawn("lower-camera")
    .add(
      new CameraComponent({
        position: new Vec2(30, 40),
        zoom: 2,
        rotation: 0.5,
        bindings: [],
      }),
    );
  const upperCamera = top
    .spawn("upper-camera")
    .add(
      new CameraComponent({
        position: new Vec2(-10, 20),
        zoom: 3,
        rotation: -0.3,
      }),
    );
  api.prepareFrame();
  return {
    engine,
    root,
    pool,
    registry,
    api,
    bottom,
    top,
    lowerCamera,
    upperCamera,
  };
}

describe("scene debug targets", () => {
  it("draws stacked vectors through their scene's effective camera despite explicit bindings", async () => {
    const {
      engine,
      api,
      registry,
      bottom,
      top,
      lowerCamera,
      upperCamera,
      root,
    } = await setup();
    vi.spyOn(lowerCamera, "effectivePosition", "get").mockReturnValue(
      new Vec2(45, 55),
    );
    vi.spyOn(lowerCamera, "effectiveZoom", "get").mockReturnValue(2.5);
    vi.spyOn(upperCamera, "effectiveRotation", "get").mockReturnValue(-0.6);
    for (const scene of [bottom, top]) {
      const entity = scene.spawn("arrow");
      entity.add(new Transform({ position: new Vec2(100, 120) }));
      registry.drawVector(entity, () => ({ x: 10, y: 0 }));
    }
    new VectorContributor(
      registry.vectors,
      engine.context.resolve(ErrorBoundaryKey),
    ).drawWorld(api);
    const lower = root.children.find((target) =>
      target.children.some(
        (g) => g.position.x === 100 && target.scale.x === 2.5,
      ),
    )!;
    const upper = root.children.find((target) =>
      target.children.some((g) => g.position.x === 100 && target.scale.x === 3),
    )!;
    expect(lower).toBeDefined();
    expect(upper).toBeDefined();
    expect(lower.rotation).toBe(-0.5);
    expect(upper.rotation).toBe(0.6);
    expect(root.children.indexOf(lower)).toBeLessThan(
      root.children.indexOf(upper),
    );
    expect(root.position.x).toBe(0);
    expect(root.scale.x).toBe(1);
  });

  it("skips hidden scenes before reading vector providers and defaults to the top visible camera", async () => {
    const { engine, api, registry, bottom } = await setup();
    bottom._resolveScoped(SceneRenderTreeKey)!.root.visible = false;
    api.prepareFrame();
    const entity = bottom.spawn("hidden");
    entity.add(new Transform());
    const read = vi.fn(() => ({ x: 10, y: 0 }));
    registry.drawVector(entity, read);
    new VectorContributor(
      registry.vectors,
      engine.context.resolve(ErrorBoundaryKey),
    ).drawWorld(api);
    expect(read).not.toHaveBeenCalled();
    expect(api.forScene(bottom)).toBeUndefined();
    expect(api.cameraZoom).toBe(3);
    const g = api.acquireGraphics()! as unknown as Container;
    expect(g.parent?.scale.x).toBe(3);
  });

  it("shares one cap and parks in-use graphics before pop and re-push", async () => {
    const { engine, api, pool, root, top, bottom } = await setup(2);
    const upper = api.forScene(top)!;
    const g = upper.acquireGraphics()! as unknown as Container;
    const oldTarget = g.parent!;
    expect(api.forScene(bottom)!.acquireGraphics()).toBeDefined();
    expect(api.acquireGraphics()).toBeUndefined();
    await engine.scenes.pop();
    expect(api.forScene(top)).toBeUndefined();
    expect(oldTarget.destroyed).toBe(true);
    expect(g.destroyed).toBe(false);
    expect(g.parent).toBe(root);
    pool.resetFrame();
    await engine.scenes.push(top);
    const fresh = api.forScene(top)!.acquireGraphics()! as unknown as Container;
    expect(fresh.parent).not.toBe(oldTarget);
    expect(fresh.destroyed).toBe(false);
    pool.resetFrame();
    expect(fresh.parent).toBe(root);
    expect(fresh.visible).toBe(false);
  });

  it.each(["sample", "drawWorld", "drawHud"] as const)(
    "attributes %s and immediately stops dispatch",
    async (method) => {
      const { engine, api, pool, root, registry } = await setup();
      const hudRoot = new Container();
      const textPool = new TextPool(hudRoot, 0);
      const later = vi.fn();
      const failure = new Error("contributor failed");
      registry.register({
        name: "broken",
        flags: [],
        [method]: () => {
          throw failure;
        },
        ...(method === "sample"
          ? { drawWorld: later }
          : method === "drawWorld"
            ? { drawHud: later }
            : {}),
      });
      registry.register({
        name: "later",
        flags: [],
        sample: later,
        drawWorld: later,
        drawHud: later,
      });
      const system = new DebugRenderSystem(
        registry,
        pool,
        textPool,
        api,
        new HudDebugApiImpl(textPool, registry, 640, 360),
        new StatsStore(),
        root,
        hudRoot,
      );
      system.onRegister(engine.context);
      expect(() => system.update(0.016)).toThrow(failure);
      expect(later).not.toHaveBeenCalled();
      expect(engine.inspector.getErrors().callbackErrors).toMatchObject([
        {
          kind: `Debug contributor ${method}`,
          event: "broken",
          error: "contributor failed",
        },
      ]);
    },
  );
});
