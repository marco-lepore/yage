import { describe, expect, it, vi } from "vitest";
import { createMockScene, ErrorBoundaryKey } from "@yagejs/core";
import { InputManager, InputManagerKey } from "@yagejs/input";
import { Hotbar } from "./core/Hotbar.js";
import { HotbarController } from "./HotbarController.js";
import { HOTBAR_ACTION_MAP } from "./controls.js";
import { HotbarActivationEvent, HotbarChangedEvent } from "./events.js";
import type { HotbarPresenter } from "./adapter.js";

function setup(inputEnabled = true) {
  const { scene, context } = createMockScene();
  const boundary = context.resolve(ErrorBoundaryKey);
  const input = new InputManager();
  input.setActionMap(HOTBAR_ACTION_MAP);
  context.register(InputManagerKey, input);
  const activate = vi.fn(() => ({ ok: true as const }));
  const model = new Hotbar({
    bindings: { a: { label: "A", activate }, b: { label: "B", activate } },
    slots: ["a", "b"],
    slotCount: 2,
  });
  const presenter: HotbarPresenter = {
    mount: vi.fn(),
    present: vi.fn(),
    setVisible: vi.fn(),
    dispose: vi.fn(),
    slotAtPoint: (x, y) =>
      y >= 0 && y < 100 && x >= 0 && x < 200 ? Math.floor(x / 100) : undefined,
  };
  const host = scene.spawn("hotbar");
  const controller = host.add(
    new HotbarController({
      model,
      presenter,
      ...(inputEnabled ? {} : { input: null }),
    }),
  );
  return {
    scene,
    context,
    boundary,
    input,
    activate,
    model,
    presenter,
    host,
    controller,
  };
}

describe("HotbarController", () => {
  it("supports input:null, mirrors activation and reports plain diagnostic state", () => {
    const { host, controller, presenter } = setup(false);
    const events = vi.fn();
    host.on(HotbarActivationEvent, events);
    controller.activate();
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({ bindingId: "a", result: { ok: true } }),
    );
    expect(controller.diagnostic).toMatchObject({
      selected: 0,
      active: true,
      lastActivation: { bindingId: "a" },
    });
    expect(presenter.mount).toHaveBeenCalledTimes(1);
  });

  it("suspends input and presentation on disable and releases ownership on removal", () => {
    const { host, controller, model, presenter, scene } = setup();
    controller.enabled = false;
    expect(controller.activate()).toEqual({ ok: false, reason: "inactive" });
    expect(presenter.setVisible).toHaveBeenLastCalledWith(false);
    controller.enabled = true;
    expect(presenter.setVisible).toHaveBeenLastCalledWith(true);
    host.remove(HotbarController);
    expect(controller.activate()).toEqual({ ok: false, reason: "inactive" });
    expect(presenter.dispose).toHaveBeenCalledTimes(1);
    expect(() =>
      scene
        .spawn("replacement")
        .add(new HotbarController({ model, input: null })),
    ).not.toThrow();
  });

  it("refuses two controllers owning one model", () => {
    const { scene, model } = setup(false);
    expect(() =>
      scene.spawn("other").add(new HotbarController({ model, input: null })),
    ).toThrow("already has");
  });

  it("activates on number keys and gamepad selection/confirm", () => {
    const { input, controller, model, activate } = setup();
    input.fireKeyDown("Digit2");
    controller.update();
    input._clearFrameState();
    input.fireKeyUp("Digit2");
    input._clearFrameState();
    expect(model.lastActivation?.bindingId).toBe("b");
    input.fireGamepadButton("GamepadLB", true);
    controller.update();
    input._clearFrameState();
    input.fireGamepadButton("GamepadLB", false);
    input._clearFrameState();
    input.fireGamepadButton("GamepadA", true);
    controller.update();
    expect(model.lastActivation?.bindingId).toBe("a");
    expect(activate).toHaveBeenCalledTimes(2);
  });

  it("claims a same-frame pointer tap and activates exactly once", () => {
    const { input, controller, activate } = setup();
    input.firePointerMove(20, 20);
    input.firePointerDown(0);
    expect(input.isPointerConsumed(1)).toBe(true);
    input.firePointerUp(0);
    controller.update();
    controller.update();
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it("swaps a dragged touch assignment without activation", () => {
    const { input, controller, model, activate } = setup();
    input.firePointerMove(20, 20, { id: 7, type: "touch" });
    input.firePointerDown(0, { id: 7, type: "touch" });
    input.firePointerMove(120, 20, { id: 7, type: "touch" });
    input.firePointerUp(0, { id: 7 });
    controller.update();
    expect(model.snapshot().slots).toEqual(["b", "a"]);
    expect(activate).not.toHaveBeenCalled();
  });

  it("ignores already consumed pointers, cancellation and focus loss", () => {
    const { input, controller, activate } = setup();
    controller.setInputEnabled(false);
    input.onPointerDown((p) => input.consumePointer(p.id));
    controller.setInputEnabled(true);
    input.firePointerMove(20, 20);
    input.firePointerDown(0);
    input.firePointerUp(0);
    controller.update();
    expect(activate).not.toHaveBeenCalled();
    const second = setup();
    second.input.firePointerMove(20, 20);
    second.input.firePointerDown(0);
    second.input._onPointerCancel(1);
    second.controller.update();
    second.input.firePointerDown(0);
    second.controller.setInputEnabled(false);
    second.input.firePointerUp(0);
    second.controller.setInputEnabled(true);
    second.controller.update();
    expect(second.activate).not.toHaveBeenCalled();
  });

  it("ignores pointer gestures while the scene is paused", () => {
    const { scene, input, controller, activate } = setup();
    scene.paused = true;
    input.firePointerMove(20, 20);
    input.firePointerDown(0);
    input.firePointerUp(0);
    scene.paused = false;
    controller.update();
    expect(activate).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "stops the current poll when an activation changes focus (rebind: %s)",
    (rebind) => {
      const { input, controller, activate } = setup();
      activate.mockImplementation(() => {
        controller.setInputEnabled(false);
        if (rebind) controller.setInputEnabled(true);
        return { ok: true };
      });
      input.fireKeyDown("Digit1");
      input.fireKeyDown("Digit2");
      controller.update();
      expect(activate).toHaveBeenCalledTimes(1);
    },
  );

  it("does not claim a pointer after an earlier listener removes focus", () => {
    const { input, controller, activate } = setup();
    controller.setInputEnabled(false);
    input.onPointerDown(() => controller.setInputEnabled(false));
    controller.setInputEnabled(true);
    const nextOwner = vi.fn();
    input.onPointerDown((pointer) => {
      if (!input.isPointerConsumed(pointer.id)) nextOwner();
    });
    input.firePointerMove(20, 20);
    input.firePointerDown(0);
    input.firePointerUp(0);
    controller.update();
    expect(input.isPointerConsumed(1)).toBe(false);
    expect(nextOwner).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
  });

  it.each(["down", "up"])(
    "ignores a stale pointer %s callback when hit testing replaces the binding",
    (phase) => {
      const { input, controller, presenter, activate } = setup();
      input.firePointerMove(20, 20);
      if (phase === "up") input.firePointerDown(0);
      vi.spyOn(presenter, "slotAtPoint").mockImplementation(() => {
        controller.setInputEnabled(false);
        controller.setInputEnabled(true);
        return 0;
      });
      if (phase === "down") {
        input.firePointerDown(0);
        expect(input.isPointerConsumed(1)).toBe(false);
      }
      input.firePointerUp(0);
      controller.update();
      expect(activate).not.toHaveBeenCalled();
    },
  );

  it.each(["key", "pointer", "navigation"])(
    "does not activate after a selection listener removes focus (%s)",
    (device) => {
      const { host, input, controller, activate, model } = setup();
      host.on(HotbarChangedEvent, () => controller.setInputEnabled(false));
      if (device === "key") input.fireKeyDown("Digit2");
      else if (device === "pointer") {
        input.firePointerMove(120, 20);
        input.firePointerDown(0);
        input.firePointerUp(0);
      } else {
        input.fireKeyDown("ArrowRight");
        input.fireKeyDown("Enter");
      }
      controller.update();
      expect(model.selection).toBe(1);
      expect(activate).not.toHaveBeenCalled();
    },
  );

  it("attributes owner failures to the scene ErrorBoundary", () => {
    const { controller, activate, boundary } = setup(false);
    activate.mockImplementation(() => {
      throw new Error("bad action");
    });
    expect(() => controller.activate()).toThrow("bad action");
    expect(boundary.getCallbackErrors()[0]).toMatchObject({
      kind: "Hotbar activate 'a'",
      entity: "hotbar",
      scene: "mock-scene",
    });
  });
});
