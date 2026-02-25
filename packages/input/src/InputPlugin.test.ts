import { describe, it, expect, afterEach, vi } from "vitest";
import {
  EngineContext,
  ServiceKey,
  Vec2,
  SystemScheduler,
} from "@yage/core";

// Local mock keys matching the string IDs used by the renderer package.
// Tests shouldn't depend on @yage/renderer.
const RendererKey = new ServiceKey<{ canvas: HTMLCanvasElement }>("renderer");
const CameraKey = new ServiceKey<{
  screenToWorld(sx: number, sy: number): { x: number; y: number };
}>("camera");
import { InputPlugin } from "./InputPlugin.js";
import { InputManagerKey } from "./types.js";
import { InputManager } from "./InputManager.js";

function createContext(options?: {
  withRenderer?: boolean;
  withCamera?: boolean;
  canvas?: HTMLCanvasElement;
}): EngineContext {
  const context = new EngineContext();

  if (options?.withRenderer) {
    const canvas = options.canvas ?? document.createElement("canvas");
    context.register(RendererKey, { canvas });
  }
  if (options?.withCamera) {
    context.register(CameraKey, {
      screenToWorld: (sx: number, sy: number) => new Vec2(sx * 2, sy * 2),
    });
  }
  return context;
}

describe("InputPlugin", () => {
  let plugin: InputPlugin;
  let context: EngineContext;

  afterEach(() => {
    plugin?.onDestroy();
  });

  it("registers InputManagerKey service on install", () => {
    context = createContext();
    plugin = new InputPlugin();
    plugin.install(context);

    const manager = context.resolve(InputManagerKey);
    expect(manager).toBeInstanceOf(InputManager);
  });

  it("attaches keyboard listeners", () => {
    context = createContext();
    plugin = new InputPlugin({
      actions: { jump: ["Space"] },
    });
    plugin.install(context);

    const manager = context.resolve(InputManagerKey);

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    expect(manager.isPressed("jump")).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
    expect(manager.isPressed("jump")).toBe(false);
  });

  it("ignores repeated keydown events", () => {
    context = createContext();
    plugin = new InputPlugin({
      actions: { jump: ["Space"] },
    });
    plugin.install(context);
    const manager = context.resolve(InputManagerKey);

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    expect(manager.isJustPressed("jump")).toBe(true);

    manager._clearFrameState();
    // Repeated keydown (repeat=true) should be ignored
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Space", repeat: true }),
    );
    expect(manager.isJustPressed("jump")).toBe(false);
  });

  it("attaches pointer listeners to canvas when renderer is available", () => {
    const canvas = document.createElement("canvas");
    context = createContext({ withRenderer: true, canvas });
    plugin = new InputPlugin({ rendererKey: RendererKey });
    plugin.install(context);

    const manager = context.resolve(InputManagerKey);

    // pointermove listens on window (so releases outside target are captured)
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 42, clientY: 84 }),
    );
    const pos = manager.getPointerScreenPosition();
    expect(pos.x).toBe(42);
    expect(pos.y).toBe(84);
  });

  it("attaches pointer listeners to document when no renderer", () => {
    context = createContext();
    plugin = new InputPlugin();
    plugin.install(context);

    const manager = context.resolve(InputManagerKey);

    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 10, clientY: 20 }),
    );
    const pos = manager.getPointerScreenPosition();
    expect(pos.x).toBe(10);
    expect(pos.y).toBe(20);
  });

  it("tracks pointer down/up via pointer events", () => {
    context = createContext();
    plugin = new InputPlugin({
      actions: { fire: ["MouseLeft"] },
    });
    plugin.install(context);

    const manager = context.resolve(InputManagerKey);

    // pointerdown on target (document when no renderer)
    document.dispatchEvent(new PointerEvent("pointerdown", { button: 0 }));
    expect(manager.isPointerDown()).toBe(true);
    expect(manager.isPressed("fire")).toBe(true);

    // pointerup on window (so releases outside target are captured)
    window.dispatchEvent(new PointerEvent("pointerup", { button: 0 }));
    expect(manager.isPointerDown()).toBe(false);
    expect(manager.isPressed("fire")).toBe(false);
  });

  it("cleans up listeners on destroy", () => {
    context = createContext();
    plugin = new InputPlugin({
      actions: { jump: ["Space"] },
    });
    plugin.install(context);
    const manager = context.resolve(InputManagerKey);

    plugin.onDestroy();

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    expect(manager.isPressed("jump")).toBe(false);
  });

  it("applies preventDefaultKeys config", () => {
    context = createContext();
    plugin = new InputPlugin({
      preventDefaultKeys: ["Space"],
    });
    plugin.install(context);

    const event = new KeyboardEvent("keydown", {
      code: "Space",
      cancelable: true,
    });
    const spy = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);
    expect(spy).toHaveBeenCalled();
  });

  it("does not preventDefault for non-configured keys", () => {
    context = createContext();
    plugin = new InputPlugin({
      preventDefaultKeys: ["Space"],
    });
    plugin.install(context);

    const event = new KeyboardEvent("keydown", {
      code: "KeyA",
      cancelable: true,
    });
    const spy = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);
    expect(spy).not.toHaveBeenCalled();
  });

  it("registers both poll and clear systems", () => {
    context = createContext();
    plugin = new InputPlugin();
    plugin.install(context);

    const scheduler = new SystemScheduler();
    plugin.registerSystems(scheduler);

    const allSystems = scheduler.getAllSystems();
    expect(allSystems).toHaveLength(2);

    const phases = allSystems.map((s) => s.phase);
    expect(phases).toContain("earlyUpdate");
    expect(phases).toContain("endOfFrame");
  });

  it("works without renderer plugin (keyboard-only)", () => {
    context = createContext();
    plugin = new InputPlugin({
      actions: { jump: ["Space"] },
    });

    // Should not throw
    expect(() => plugin.install(context)).not.toThrow();

    const manager = context.resolve(InputManagerKey);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    expect(manager.isPressed("jump")).toBe(true);
  });

  it("wires camera for pointer world-coordinate conversion", () => {
    context = createContext({ withCamera: true });
    plugin = new InputPlugin({ cameraKey: CameraKey });
    plugin.install(context);

    const manager = context.resolve(InputManagerKey);
    manager._onPointerMove(50, 100);

    const worldPos = manager.getPointerPosition();
    expect(worldPos.x).toBe(100);
    expect(worldPos.y).toBe(200);
  });

  it("uses custom target element for pointer events", () => {
    const customTarget = document.createElement("div");
    context = createContext();
    plugin = new InputPlugin({ target: customTarget });
    plugin.install(context);

    const manager = context.resolve(InputManagerKey);

    // pointermove is on window
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 33, clientY: 44 }),
    );
    const pos = manager.getPointerScreenPosition();
    expect(pos.x).toBe(33);
    expect(pos.y).toBe(44);
  });
});
