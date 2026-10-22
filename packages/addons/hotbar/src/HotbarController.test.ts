import { describe, expect, it, vi } from "vitest";
import { createMockScene, ErrorBoundaryKey } from "@yagejs/core";
import { InputManager, InputManagerKey } from "@yagejs/input";
import { Hotbar } from "./core/Hotbar.js";
import { HotbarController } from "./HotbarController.js";
import { HOTBAR_ACTION_MAP, hotbarControls } from "./controls.js";
import { HotbarActivationEvent, HotbarChangedEvent } from "./events.js";
import type { HotbarInputBinding, HotbarPresenter } from "./adapter.js";

const dragControls = () => hotbarControls({ dragToSwap: true });

function setup(controls?: HotbarInputBinding | null) {
  const { scene, context } = createMockScene();
  const boundary = context.resolve(ErrorBoundaryKey);
  const input = new InputManager();
  input.setActionMap(HOTBAR_ACTION_MAP);
  context.register(InputManagerKey, input);
  const activate = vi.fn(() => ({ ok: true as const }));
  const release = vi.fn();
  const state = { available: true };
  const read = () => ({ available: state.available });
  const model = new Hotbar({
    bindings: {
      a: { label: "A", read, activate, release },
      b: { label: "B", read, activate, release },
    },
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
      ...(controls === undefined ? {} : { input: controls }),
    }),
  );
  return {
    scene,
    context,
    boundary,
    input,
    activate,
    release,
    state,
    model,
    presenter,
    host,
    controller,
  };
}

describe("HotbarController", () => {
  it("supports input:null, mirrors activation and reports plain diagnostic state", () => {
    const { host, controller, model, presenter, scene } = setup(null);
    const events = vi.fn();
    host.on(HotbarActivationEvent, events);
    model.activate();
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({ bindingId: "a", result: { ok: true } }),
    );
    expect(controller.diagnostic).toMatchObject({
      selected: 0,
      active: true,
      lastActivation: { bindingId: "a" },
    });
    expect(presenter.mount).toHaveBeenCalledWith(scene);
  });

  it("suspends input and presentation on disable and releases ownership on removal", () => {
    const { host, controller, model, presenter, scene, input, activate } =
      setup();
    controller.enabled = false;
    input.fireKeyDown("Digit1");
    controller.update();
    expect(activate).not.toHaveBeenCalled();
    expect(presenter.setVisible).toHaveBeenLastCalledWith(false);
    controller.enabled = true;
    expect(presenter.setVisible).toHaveBeenLastCalledWith(true);
    host.remove(HotbarController);
    expect(controller.diagnostic.active).toBe(false);
    expect(model.activate()).toEqual({ ok: true });
    expect(presenter.dispose).toHaveBeenCalledTimes(1);
    expect(() =>
      scene
        .spawn("replacement")
        .add(new HotbarController({ model, input: null })),
    ).not.toThrow();
  });

  it("refuses two controllers owning one model", () => {
    const { scene, model } = setup(null);
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

  it("swaps a dragged touch assignment without activation when drag-to-swap is on", () => {
    const { input, controller, model, activate } = setup(dragControls());
    input.firePointerMove(20, 20, { id: 7, type: "touch" });
    input.firePointerDown(0, { id: 7, type: "touch" });
    input.firePointerMove(120, 20, { id: 7, type: "touch" });
    input.firePointerUp(0, { id: 7 });
    controller.update();
    expect(model.snapshot().slots).toEqual(["b", "a"]);
    expect(activate).not.toHaveBeenCalled();
  });

  it("ignores consumed pointers, cancellation and focus loss with drag-to-swap on", () => {
    const { input, controller, activate } = setup(dragControls());
    controller.setInputEnabled(false);
    input.onPointerDown((p) => input.consumePointer(p.id));
    controller.setInputEnabled(true);
    input.firePointerMove(20, 20);
    input.firePointerDown(0);
    input.firePointerUp(0);
    controller.update();
    expect(activate).not.toHaveBeenCalled();
    const second = setup(dragControls());
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
      const { input, controller, activate, release } = setup();
      activate.mockImplementation(() => {
        controller.setInputEnabled(false);
        if (rebind) controller.setInputEnabled(true);
        return { ok: true };
      });
      input.fireKeyDown("Digit1");
      input.fireKeyDown("Digit2");
      controller.update();
      expect(activate).toHaveBeenCalledTimes(1);
      // The disposed binding cannot see the key go up, so the hold ends now.
      expect(release).toHaveBeenCalledOnce();
      input._clearFrameState();
      input.fireKeyUp("Digit1");
      controller.setInputEnabled(true);
      controller.update();
      controller.setInputEnabled(false);
      expect(release).toHaveBeenCalledOnce();
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
      const { input, controller, presenter, activate } = setup(dragControls());
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
    const { model, activate, boundary } = setup(null);
    activate.mockImplementation(() => {
      throw new Error("bad action");
    });
    expect(() => model.activate()).toThrow("bad action");
    expect(boundary.getCallbackErrors()[0]).toMatchObject({
      kind: "Hotbar activate 'a'",
      entity: "hotbar",
      scene: "mock-scene",
    });
  });

  it("releases a held action when its key goes up", () => {
    const { input, controller, release } = setup();
    input.fireKeyDown("Digit1");
    controller.update();
    input._clearFrameState();
    controller.update();
    expect(release).not.toHaveBeenCalled();
    input.fireKeyUp("Digit1");
    controller.update();
    expect(release).toHaveBeenCalledOnce();
  });

  it("releases the slot the activate key pressed, not the new selection", () => {
    const { input, controller, model, release } = setup();
    input.fireKeyDown("Enter");
    controller.update();
    input._clearFrameState();
    model.select(1);
    input.fireKeyUp("Enter");
    controller.update();
    expect(release).toHaveBeenCalledOnce();
    expect(model.lastActivation?.slot).toBe(0);
  });

  it("releases held actions when input focus is lost", () => {
    const { input, controller, release } = setup();
    input.fireKeyDown("Digit2");
    controller.update();
    controller.setInputEnabled(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it("keeps a key's hold when read() rejects a tap on the same slot", () => {
    const { input, controller, activate, release, state } = setup();
    input.fireKeyDown("Digit1");
    controller.update();
    input._clearFrameState();
    state.available = false;
    input.firePointerMove(20, 20);
    input.firePointerDown(0);
    input.firePointerUp(0);
    controller.update();
    expect(activate).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
    input._clearFrameState();
    input.fireKeyUp("Digit1");
    controller.update();
    expect(release).toHaveBeenCalledOnce();
  });

  it("gives a slot's hold to the latest input that activated it", () => {
    const { input, controller, release } = setup();
    input.fireKeyDown("Digit1");
    controller.update();
    input._clearFrameState();
    input.fireKeyDown("Enter");
    controller.update();
    // Activating slot 0 again ends the hold the number key started.
    expect(release).toHaveBeenCalledOnce();
    input._clearFrameState();
    input.fireKeyUp("Digit1");
    controller.update();
    expect(release).toHaveBeenCalledOnce();
    input._clearFrameState();
    input.fireKeyUp("Enter");
    controller.update();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("activates and releases on a pointer tap", () => {
    const { input, controller, activate, release } = setup();
    input.firePointerMove(20, 20);
    input.firePointerDown(0);
    input.firePointerUp(0);
    controller.update();
    expect(activate).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("holds a pointer press until the pointer lifts", () => {
    const { input, controller, model, activate, release } = setup();
    input.firePointerMove(120, 20);
    input.firePointerDown(0);
    controller.update();
    expect(model.lastActivation?.slot).toBe(1);
    input._clearFrameState();
    input.firePointerMove(20, 20);
    controller.update();
    expect(release).not.toHaveBeenCalled();
    input.firePointerUp(0);
    controller.update();
    expect(activate).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(model.snapshot().slots).toEqual(["a", "b"]);
  });

  it("releases a pointer hold on cancellation and after a pause", () => {
    const { scene, input, controller, release } = setup();
    input.firePointerMove(20, 20);
    input.firePointerDown(0);
    controller.update();
    input._onPointerCancel(1);
    controller.update();
    expect(release).toHaveBeenCalledOnce();
    input._clearFrameState();
    input.firePointerDown(0);
    controller.update();
    scene.paused = true;
    input.firePointerUp(0);
    scene.paused = false;
    controller.update();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("switches drag-to-swap while running, from the next pointer press", () => {
    const controls = hotbarControls();
    const { input, controller, model, activate, release } = setup(controls);
    expect(controls.dragToSwap).toBe(false);
    input.firePointerMove(20, 20);
    input.firePointerDown(0);
    controller.update();
    controls.setDragToSwap(true);
    expect(controls.dragToSwap).toBe(true);
    // The press in progress keeps holding and releases on lift.
    input._clearFrameState();
    input.firePointerMove(120, 20);
    controller.update();
    expect(release).not.toHaveBeenCalled();
    input.firePointerUp(0);
    controller.update();
    expect(release).toHaveBeenCalledOnce();
    expect(model.snapshot().slots).toEqual(["a", "b"]);
    input._clearFrameState();
    input.firePointerMove(20, 20);
    input.firePointerDown(0);
    input.firePointerMove(120, 20);
    input.firePointerUp(0);
    controller.update();
    expect(model.snapshot().slots).toEqual(["b", "a"]);
    expect(activate).toHaveBeenCalledOnce();
  });

  it("finishes a drag in progress as a drag after drag-to-swap is turned off", () => {
    const controls = hotbarControls({ dragToSwap: true });
    const { input, controller, model, activate } = setup(controls);
    input.firePointerMove(20, 20);
    input.firePointerDown(0);
    controller.update();
    controls.setDragToSwap(false);
    input.firePointerMove(120, 20);
    input.firePointerUp(0);
    controller.update();
    expect(model.snapshot().slots).toEqual(["b", "a"]);
    expect(activate).not.toHaveBeenCalled();
  });

  it("refuses one controls object bound to two controllers", () => {
    const controls = hotbarControls();
    const { scene } = setup(controls);
    const other = new Hotbar({ bindings: {}, slotCount: 1 });
    expect(() =>
      scene
        .spawn("second")
        .add(new HotbarController({ model: other, input: controls })),
    ).toThrow("one controls object per controller");
  });

  it("keeps tracking a new hold when releasing the earlier one throws", () => {
    const { input, controller, release } = setup();
    input.fireKeyDown("Enter");
    controller.update();
    input._clearFrameState();
    release.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    // Within one frame: Enter up, select the next slot, Enter down again.
    input.fireKeyUp("Enter");
    input.fireKeyDown("ArrowRight");
    input.fireKeyDown("Enter");
    expect(() => controller.update()).toThrow("boom");
    controller.setInputEnabled(false);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("applies a focus loss made during bind() once bind() returns", () => {
    const binding: HotbarInputBinding = {
      bind: vi.fn((_input, driver) => driver.select(1)),
      poll: vi.fn(),
      dispose: vi.fn(),
    };
    const { scene, context } = createMockScene();
    context.register(InputManagerKey, new InputManager());
    const model = new Hotbar({
      bindings: { a: { label: "A", activate: () => ({ ok: true }) } },
      slots: ["a"],
      slotCount: 2,
    });
    const controller = new HotbarController({ model, input: binding });
    const host = scene.spawn("hotbar");
    host.on(HotbarChangedEvent, () => controller.setInputEnabled(false));
    host.add(controller);
    controller.update();
    expect(model.selection).toBe(1);
    expect(binding.dispose).toHaveBeenCalledOnce();
    expect(binding.poll).not.toHaveBeenCalled();
    controller.setInputEnabled(true);
    expect(binding.bind).toHaveBeenCalledTimes(2);
  });
});
