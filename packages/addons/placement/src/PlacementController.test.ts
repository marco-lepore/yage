import { describe, expect, it, vi } from "vitest";
import { createMockEntity, ErrorBoundaryKey } from "@yagejs/core";
import {
  PlacementCommittedEvent,
  PlacementController,
  PlacementRejectedEvent,
} from "./PlacementController.js";
import { InputManager, InputManagerKey } from "@yagejs/input";
import { placementControls } from "./input.js";
import { layout, target } from "./core/fixtures.js";

describe("PlacementController", () => {
  it("mounts separate channels, mirrors outcomes and releases input across disable and teardown", () => {
    const { entity } = createMockEntity();
    const model = layout();
    const input = { bind: vi.fn(), poll: vi.fn(), dispose: vi.fn() };
    const preview = { mount: vi.fn(), show: vi.fn(), dispose: vi.fn() };
    const catalog = {
      mount: vi.fn(),
      show: vi.fn(),
      typeAtPoint: vi.fn(() => null),
      dispose: vi.fn(),
    };
    const controller = entity.add(
      new PlacementController({ model, input, preview, catalog }),
    );
    const committed = vi.fn(),
      rejected = vi.fn();
    entity.on(PlacementCommittedEvent, committed);
    entity.on(PlacementRejectedEvent, rejected);
    controller.editor.select("table", target(100));
    expect(controller.editor.confirm()?.ok).toBe(true);
    controller.editor.select("table", target(100));
    expect(controller.editor.confirm()?.ok).toBe(false);
    expect(committed).toHaveBeenCalledTimes(1);
    expect(rejected).toHaveBeenCalledTimes(1);
    controller.update();
    expect(input.poll).toHaveBeenCalledOnce();
    expect(preview.show).toHaveBeenCalledOnce();
    controller.enabled = false;
    expect(controller.inspection?.command).toBeNull();
    expect(() => controller.editor).toThrow("enabled live host");
    expect(input.dispose).toHaveBeenCalledOnce();
    expect(preview.dispose).toHaveBeenCalledOnce();
    controller.enabled = true;
    expect(input.bind).toHaveBeenCalledTimes(2);
    controller.destroy();
    model.commit({ kind: "place", type: "table", target: target(300) });
    expect(committed).toHaveBeenCalledTimes(1);
  });

  it("attributes model rules and extension callbacks to the engine boundary", () => {
    const { entity, context } = createMockEntity();
    const controller = entity.add(
      new PlacementController({
        input: null,
        model: layout({
          rules: [
            {
              id: "broken",
              evaluate: () => {
                throw new Error("bad policy");
              },
            },
          ],
        }),
      }),
    );
    expect(() => controller.editor.select("table", target(100))).toThrow(
      "bad policy",
    );
    expect(context.resolve(ErrorBoundaryKey).getCallbackErrors()).toMatchObject(
      [{ kind: "Placement rule broken", entity: entity.name }],
    );
    const other = createMockEntity();
    expect(() =>
      other.entity.add(
        new PlacementController({
          input: null,
          model: layout(),
          preview: {
            mount: () => {
              throw new Error("bad mount");
            },
            show: () => {},
            dispose: () => {},
          },
        }),
      ),
    ).toThrow("bad mount");
    expect(
      other.context.resolve(ErrorBoundaryKey).getCallbackErrors()[0]?.kind,
    ).toBe("Placement preview mount");
  });
});

it("supports default device input and explicit host-only control", () => {
  const { entity, scene } = createMockEntity();
  const input = new InputManager();
  input.setActionMap(placementControls());
  scene.context.register(InputManagerKey, input);
  const model = layout();
  model.commit({ kind: "place", type: "table", target: target(100) });
  const controller = entity.add(new PlacementController({ model }));
  input.firePointerMove(100, 100, { type: "touch" });
  input.firePointerDown(0, { type: "touch" });
  controller.update();
  expect(controller.inspection?.command?.kind).toBe("move");
  input._clearFrameState();
  input.fireGamepadButton("GamepadB", true);
  controller.update();
  expect(controller.inspection?.command).toBeNull();
  const headless = createMockEntity();
  const controlled = headless.entity.add(
    new PlacementController({ model: layout(), input: null }),
  );
  controlled.editor.select("table", target(100));
  controlled.update();
  expect(controlled.editor.confirm()?.ok).toBe(true);
});
