import { describe, it, expect, afterEach, vi } from "vitest";
import {
  EngineContext,
  RendererAdapterKey,
  ServiceKey,
  Vec2,
  SystemScheduler,
} from "@yagejs/core";

// Local mock key — simulates a foreign (non-@yagejs/renderer) renderer
// registered under its own ServiceKey. ServiceKey lookup is by reference
// identity, not string id, so the `"customRenderer"` label is purely
// diagnostic.
const CustomRendererKey = new ServiceKey<{ canvas: HTMLCanvasElement }>(
  "customRenderer",
);
import { DebugRegistryKey } from "@yagejs/debug/api";
import { InputPlugin } from "./InputPlugin.js";
import { InputManagerKey } from "./types.js";
import { InputManager } from "./InputManager.js";

function createContext(options?: {
  withRenderer?: boolean;
  underKey?: ServiceKey<{ canvas: HTMLCanvasElement }>;
  canvas?: HTMLCanvasElement;
}): EngineContext {
  const context = new EngineContext();

  if (options?.withRenderer) {
    const canvas = options.canvas ?? document.createElement("canvas");
    const key = options.underKey ?? RendererAdapterKey;
    context.register(key, { canvas });
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

  it("auto-resolves RendererAdapterKey and attaches pointer listeners to its canvas", () => {
    const canvas = document.createElement("canvas");
    context = createContext({ withRenderer: true, canvas });
    plugin = new InputPlugin();
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

  it("accepts a custom rendererKey override", () => {
    const canvas = document.createElement("canvas");
    context = createContext({
      withRenderer: true,
      canvas,
      underKey: CustomRendererKey,
    });
    plugin = new InputPlugin({ rendererKey: CustomRendererKey });
    plugin.install(context);

    const manager = context.resolve(InputManagerKey);

    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 42, clientY: 84 }),
    );
    const pos = manager.getPointerScreenPosition();
    expect(pos.x).toBe(42);
    expect(pos.y).toBe(84);
  });

  it("routes pointer coords through adapter.canvasToVirtual when present", () => {
    const canvas = document.createElement("canvas");
    // JSDOM getBoundingClientRect returns zeros by default, so clientX/Y
    // pass through as canvas-relative CSS pixels unchanged. The adapter's
    // canvasToVirtual doubles them to prove the branch ran.
    const context = new EngineContext();
    context.register(RendererAdapterKey, {
      canvas,
      canvasToVirtual: (x, y) => ({ x: x * 2, y: y * 2 }),
    });
    plugin = new InputPlugin();
    plugin.install(context);

    const manager = context.resolve(InputManagerKey);
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 10, clientY: 20 }),
    );
    const pos = manager.getPointerScreenPosition();
    expect(pos.x).toBe(20);
    expect(pos.y).toBe(40);
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

  it("setCamera enables pointer world-coordinate conversion", () => {
    context = createContext();
    plugin = new InputPlugin();
    plugin.install(context);

    const manager = context.resolve(InputManagerKey);
    manager.setCamera({
      screenToWorld: (sx: number, sy: number) => new Vec2(sx * 2, sy * 2),
    });
    manager.firePointerMove(50, 100);

    const worldPos = manager.getPointerPosition();
    expect(worldPos.x).toBe(100);
    expect(worldPos.y).toBe(200);
  });

  it("clearCamera reverts to screen coordinates", () => {
    context = createContext();
    plugin = new InputPlugin();
    plugin.install(context);

    const manager = context.resolve(InputManagerKey);
    manager.setCamera({
      screenToWorld: (sx: number, sy: number) => new Vec2(sx * 2, sy * 2),
    });
    manager.clearCamera();
    manager.firePointerMove(50, 100);

    const pos = manager.getPointerPosition();
    expect(pos.x).toBe(50);
    expect(pos.y).toBe(100);
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

  it("passes groups config to InputManager", () => {
    context = createContext();
    plugin = new InputPlugin({
      actions: { jump: ["Space"], fire: ["MouseLeft"] },
      groups: { movement: ["jump"], combat: ["fire"] },
    });
    plugin.install(context);

    const manager = context.resolve(InputManagerKey);
    expect(manager.getGroups()).toEqual(["movement", "combat"]);
    expect(manager.getGroupActions("movement")).toEqual(["jump"]);
  });

  it("works without groups config", () => {
    context = createContext();
    plugin = new InputPlugin({ actions: { jump: ["Space"] } });
    plugin.install(context);

    const manager = context.resolve(InputManagerKey);
    expect(manager.getGroups()).toEqual([]);
  });

  it("handles pointercancel events", () => {
    context = createContext();
    plugin = new InputPlugin({
      actions: { fire: ["MouseLeft"] },
    });
    plugin.install(context);
    const manager = context.resolve(InputManagerKey);

    document.dispatchEvent(new PointerEvent("pointerdown", { button: 0 }));
    expect(manager.isPointerDown()).toBe(true);

    window.dispatchEvent(new PointerEvent("pointercancel"));
    expect(manager.isPointerDown()).toBe(false);
  });

  it("maps mouse middle and right buttons", () => {
    context = createContext();
    plugin = new InputPlugin({
      actions: {
        middleClick: ["MouseMiddle"],
        rightClick: ["MouseRight"],
      },
    });
    plugin.install(context);
    const manager = context.resolve(InputManagerKey);

    document.dispatchEvent(new PointerEvent("pointerdown", { button: 1 }));
    expect(manager.isPressed("middleClick")).toBe(true);
    window.dispatchEvent(new PointerEvent("pointerup", { button: 1 }));

    document.dispatchEvent(new PointerEvent("pointerdown", { button: 2 }));
    expect(manager.isPressed("rightClick")).toBe(true);
    window.dispatchEvent(new PointerEvent("pointerup", { button: 2 }));
  });

  it("calls preventDefault on keyup for configured keys", () => {
    context = createContext();
    plugin = new InputPlugin({
      preventDefaultKeys: ["Space"],
    });
    plugin.install(context);

    const event = new KeyboardEvent("keyup", {
      code: "Space",
      cancelable: true,
    });
    const spy = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);
    expect(spy).toHaveBeenCalled();
  });

  it("ignores unmapped mouse buttons on pointerdown and pointerup", () => {
    context = createContext();
    plugin = new InputPlugin({ actions: { fire: ["MouseLeft"] } });
    plugin.install(context);
    const manager = context.resolve(InputManagerKey);

    // Buttons 3+ (back / forward / etc.) don't fire Mouse* action codes and
    // don't count toward `isPointerDown` — only buttons 0/1/2 do. The pointer
    // record itself is still tracked.
    document.dispatchEvent(new PointerEvent("pointerdown", { button: 3 }));
    expect(manager.isPointerDown()).toBe(false);
    // `fire` is bound to `MouseLeft`; if button 3 ever started firing the
    // primary mouse code by mistake, this would catch it.
    expect(manager.isPressed("fire")).toBe(false);

    window.dispatchEvent(new PointerEvent("pointerup", { button: 3 }));
    expect(manager.isPointerDown()).toBe(false);
  });

  it("forwards pointerType from PointerEvent to PointerInfo", () => {
    context = createContext();
    plugin = new InputPlugin();
    plugin.install(context);
    const manager = context.resolve(InputManagerKey);

    document.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        pointerId: 42,
        pointerType: "touch",
        isPrimary: true,
      }),
    );

    const pointer = manager.getPointer(42);
    expect(pointer?.type).toBe("touch");
    expect(pointer?.isPrimary).toBe(true);
  });

  it("pointercancel removes the pointer and releases aggregate buttons", () => {
    context = createContext();
    plugin = new InputPlugin({ actions: { fire: ["MouseLeft"] } });
    plugin.install(context);
    const manager = context.resolve(InputManagerKey);

    document.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        pointerId: 7,
        pointerType: "touch",
        isPrimary: true,
      }),
    );
    expect(manager.isPressed("fire")).toBe(true);

    window.dispatchEvent(
      new PointerEvent("pointercancel", { pointerId: 7 }),
    );
    expect(manager.getPointer(7)).toBeUndefined();
    expect(manager.isPressed("fire")).toBe(false);
  });

  it("tracks two simultaneous touch pointers independently", () => {
    context = createContext();
    plugin = new InputPlugin();
    plugin.install(context);
    const manager = context.resolve(InputManagerKey);

    document.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        pointerId: 100,
        pointerType: "touch",
        isPrimary: true,
        clientX: 10,
        clientY: 20,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        pointerId: 101,
        pointerType: "touch",
        isPrimary: false,
        clientX: 200,
        clientY: 300,
      }),
    );

    const all = manager.getPointers();
    expect(all.length).toBe(2);
    const primary = all.find((p) => p.isPrimary);
    expect(primary?.id).toBe(100);
    expect(primary?.screenPos.x).toBe(10);
  });

  it("falls back to 'mouse' when PointerEvent.pointerType is empty", () => {
    context = createContext();
    plugin = new InputPlugin();
    plugin.install(context);
    const manager = context.resolve(InputManagerKey);

    document.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        pointerId: 50,
        pointerType: "",
        isPrimary: true,
      }),
    );

    expect(manager.getPointer(50)?.type).toBe("mouse");
  });

  it("onStart registers debug contributor when debug registry is available", () => {
    context = createContext();
    const mockRegister = vi.fn();
    context.register(DebugRegistryKey, {
      register: mockRegister,
      isEnabled: () => true,
      isFlagEnabled: () => true,
    });
    plugin = new InputPlugin({ actions: { jump: ["Space"] } });
    plugin.install(context);
    plugin.onStart();

    expect(mockRegister).toHaveBeenCalledTimes(1);
    const firstCall = mockRegister.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toHaveProperty("name", "input");
  });

  it("onStart does not crash when debug registry is not available", () => {
    context = createContext();
    plugin = new InputPlugin();
    plugin.install(context);

    expect(() => plugin.onStart()).not.toThrow();
  });

  it("forwards gamepadconnected events to the manager", () => {
    context = createContext();
    plugin = new InputPlugin();
    plugin.install(context);
    const manager = context.resolve(InputManagerKey);

    const seen: number[] = [];
    manager.onGamepadConnected((info) => seen.push(info.index));

    const event = new Event("gamepadconnected") as Event & { gamepad: Gamepad };
    (event as { gamepad: Gamepad }).gamepad = {
      index: 0,
      id: "test-pad",
    } as Gamepad;
    window.dispatchEvent(event);
    expect(seen).toEqual([0]);
  });

  it("forwards gamepaddisconnected events to the manager", () => {
    context = createContext();
    plugin = new InputPlugin();
    plugin.install(context);
    const manager = context.resolve(InputManagerKey);

    // Connect first so the disconnect actually does something — the
    // disconnect handler is now idempotent for unknown pads.
    manager._onGamepadConnected({ index: 1, id: "test-pad" });

    const seen: number[] = [];
    manager.onGamepadDisconnected((info) => seen.push(info.index));

    const event = new Event("gamepaddisconnected") as Event & {
      gamepad: Gamepad;
    };
    (event as { gamepad: Gamepad }).gamepad = {
      index: 1,
      id: "test-pad",
    } as Gamepad;
    window.dispatchEvent(event);
    expect(seen).toEqual([1]);
  });

  it("releases held gamepad codes when tab visibility goes hidden", () => {
    context = createContext();
    plugin = new InputPlugin({ actions: { jump: ["GamepadA"] } });
    plugin.install(context);
    const manager = context.resolve(InputManagerKey);

    manager.fireGamepadButton("GamepadA", true);
    expect(manager.isPressed("jump")).toBe(true);

    // Save the original descriptor so the override doesn't bleed into other
    // specs that share the document object.
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "visibilityState",
    );
    try {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      expect(manager.isPressed("jump")).toBe(false);
    } finally {
      // Remove our override; jsdom's prototype getter takes over again.
      delete (document as unknown as { visibilityState?: unknown })
        .visibilityState;
      if (originalDescriptor) {
        Object.defineProperty(
          Document.prototype,
          "visibilityState",
          originalDescriptor,
        );
      }
    }
  });

  it("clears held pointer state when tab visibility goes hidden", () => {
    context = createContext();
    plugin = new InputPlugin({ actions: { fire: ["MouseLeft"] } });
    plugin.install(context);
    const manager = context.resolve(InputManagerKey);

    document.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        pointerId: 7,
        pointerType: "touch",
        isPrimary: true,
      }),
    );
    expect(manager.isPressed("fire")).toBe(true);
    expect(manager.getPointer(7)).toBeDefined();

    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "visibilityState",
    );
    try {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));

      expect(manager.isPressed("fire")).toBe(false);
      expect(manager.getPointers()).toHaveLength(0);
    } finally {
      delete (document as unknown as { visibilityState?: unknown })
        .visibilityState;
      if (originalDescriptor) {
        Object.defineProperty(
          Document.prototype,
          "visibilityState",
          originalDescriptor,
        );
      }
    }
  });

  it("pointerleave on canvas removes a hovering touch / pen pointer", () => {
    context = createContext();
    plugin = new InputPlugin();
    plugin.install(context);
    const manager = context.resolve(InputManagerKey);

    // A pen hovering over the canvas: pointermove with no pointerdown.
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 42,
        pointerType: "pen",
        isPrimary: true,
      }),
    );
    expect(manager.getPointer(42)).toBeDefined();

    document.dispatchEvent(
      new PointerEvent("pointerleave", {
        pointerId: 42,
        pointerType: "pen",
      }),
    );
    expect(manager.getPointer(42)).toBeUndefined();
  });

  it("pointerleave keeps mouse pointers tracked (cursor persistence)", () => {
    context = createContext();
    plugin = new InputPlugin();
    plugin.install(context);
    const manager = context.resolve(InputManagerKey);

    window.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
    expect(manager.getPointer(1)).toBeDefined();

    document.dispatchEvent(
      new PointerEvent("pointerleave", {
        pointerId: 1,
        pointerType: "mouse",
      }),
    );
    expect(manager.getPointer(1)).toBeDefined();
  });

  it("applies deadzones, triggerThreshold, and pollGamepads from config", () => {
    context = createContext();
    plugin = new InputPlugin({
      deadzones: { stick: 0.4, trigger: 0.2 },
      triggerThreshold: 0.7,
      pollGamepads: false,
    });
    plugin.install(context);
    const manager = context.resolve(InputManagerKey);

    expect(manager.isPollingEnabled()).toBe(false);

    manager.fireGamepadAxis("leftX", 0.3);
    expect(manager.getStick("left")).toEqual(Vec2.ZERO);
    manager.fireGamepadAxis("leftX", 0.5);
    expect(manager.getStick("left").x).toBeGreaterThan(0);
  });
});
