import { expect, it } from "vitest";
import { createMockEntity, ErrorBoundaryKey } from "@yagejs/core";
import { InputManager, InputManagerKey } from "@yagejs/input";
import { PlacementSession } from "./core/PlacementSession.js";
import { layout, target } from "./core/fixtures.js";
import type { PlacementPointerInputOptions } from "./input.js";
import { PlacementPointerInput, placementControls } from "./input.js";

function setup(options: PlacementPointerInputOptions = {}) {
  const { entity, scene } = createMockEntity();
  const input = new InputManager();
  input.setActionMap(placementControls());
  scene.context.register(InputManagerKey, input);
  const model = layout();
  const session = new PlacementSession(model);
  const binding = new PlacementPointerInput(options);
  binding.bind(entity, session);
  return { input, model, session, binding, scene };
}

it("claims only handled presses and respects earlier claims", () => {
  const { input, model, binding } = setup();
  input.firePointerMove(0, 0);
  input.firePointerDown();
  binding.poll();
  expect(input.getPointerPresses()).toHaveLength(1);
  input.clearAll();
  model.commit({ kind: "place", type: "table", target: target(100) });
  input.firePointerMove(100, 100);
  input.firePointerDown();
  input.consumePointer(input.getPointerPresses()[0]!.id);
  binding.poll();
  expect(binding.selectedId).toBeNull();
  input.clearAll();
  input.firePointerMove(100, 100);
  input.firePointerDown();
  binding.poll();
  expect(binding.selectedId).toBe("p1");
  expect(input.getPointerPresses()).toEqual([]);
});

it("keeps the selected pivot in place until the pointer moves", () => {
  const { input, model, binding } = setup();
  model.commit({ kind: "place", type: "table", target: target(100) });
  input.firePointerMove(80, 100);
  input.firePointerDown();
  binding.poll();
  input._clearFrameState();
  input.firePointerUp();
  binding.poll();
  input._clearFrameState();
  input.fireKeyDown("KeyR");
  binding.poll();
  input._clearFrameState();
  input.fireKeyUp("KeyR");
  input.fireKeyDown("Enter");
  binding.poll();
  expect(model.worldPose("p1")).toEqual({
    x: 100,
    y: 100,
    rotation: Math.PI / 2,
  });
});

it("projects game-specific supports before applying the shared grid and validation", () => {
  const { input, session, model, binding } = setup({
    project: (pose) => ({ pose: { ...pose, y: 192 } }),
  });
  session.select("table");
  input.firePointerMove(110, 83);
  input.firePointerDown();
  binding.poll();
  expect(model.worldPose("p1")).toMatchObject({ x: 112, y: 192 });
});

it("attributes projection errors and rejects nonfinite projected poses before mutation", () => {
  const throwing = setup({
    project: () => {
      throw new Error("bad support");
    },
  });
  throwing.session.select("table");
  expect(() => throwing.binding.poll()).toThrow("bad support");
  expect(
    throwing.scene.use(ErrorBoundaryKey).getCallbackErrors()[0]?.kind,
  ).toBe("Placement pointer projection");
  expect(throwing.model.snapshot().objects).toHaveLength(0);
  const invalid = setup({
    project: (pose) => ({ pose: { ...pose, y: Infinity } }),
  });
  invalid.session.select("table");
  expect(() => invalid.binding.poll()).toThrow("finite number");
  expect(invalid.model.snapshot().objects).toHaveLength(0);
});

it("maps renderer coordinates for both picking and grid placement", () => {
  const { input, model, session, binding } = setup({
    toLayout: (point) => ({ ...point, x: point.x - 500, y: point.y - 200 }),
  });
  model.commit({ kind: "place", type: "table", target: target(100) });
  input.firePointerMove(600, 300);
  input.firePointerDown();
  binding.poll();
  expect(binding.selectedId).toBe("p1");
  expect(session.inspect().command).toMatchObject({
    kind: "move",
    target: target(100),
  });
  input._clearFrameState();
  input.firePointerUp();
  input.firePointerMove(650, 360);
  input.fireKeyDown("Enter");
  binding.poll();
  expect(model.worldPose("p1")).toMatchObject({ x: 144, y: 160 });
});

it("uses artwork picking and treats null as an explicit miss", () => {
  const hit = setup({ hitTest: () => "p1" });
  hit.model.commit({ kind: "place", type: "table", target: target(100) });
  hit.input.firePointerMove(500, 20);
  hit.input.firePointerDown();
  hit.binding.poll();
  expect(hit.binding.selectedId).toBe("p1");
  const miss = setup({ hitTest: () => null });
  miss.model.commit({ kind: "place", type: "table", target: target(100) });
  miss.input.firePointerMove(100, 100);
  miss.input.firePointerDown();
  miss.binding.poll();
  expect(miss.binding.selectedId).toBeNull();
  expect(miss.input.getPointerPresses()).toHaveLength(1);
});

it("attributes coordinate and picking callbacks and rejects invalid results before selection", () => {
  const invalid = setup({ toLayout: (point) => ({ ...point, x: NaN }) });
  expect(() => invalid.binding.poll()).toThrow("finite number");
  const coordinates = setup({
    toLayout: () => {
      throw new Error("bad coordinates");
    },
  });
  expect(() => coordinates.binding.poll()).toThrow("bad coordinates");
  expect(
    coordinates.scene.use(ErrorBoundaryKey).getCallbackErrors()[0]?.kind,
  ).toBe("Placement pointer coordinates");
  const pick = setup({
    hitTest: () => {
      throw new Error("bad pick");
    },
  });
  pick.input.firePointerDown();
  expect(() => pick.binding.poll()).toThrow("bad pick");
  expect(pick.scene.use(ErrorBoundaryKey).getCallbackErrors()[0]?.kind).toBe(
    "Placement pointer hit test",
  );
  const unknown = setup({ hitTest: () => "missing" });
  unknown.input.firePointerDown();
  expect(() => unknown.binding.poll()).toThrow("unknown object missing");
  expect(unknown.binding.selectedId).toBeNull();
  expect(unknown.input.getPointerPresses()).toHaveLength(1);
});

it("click confirmation preserves the displayed pivot when the pointer has not moved", () => {
  const { input, model, session, binding } = setup();
  model.commit({ kind: "place", type: "table", target: target(100) });
  input.firePointerMove(80, 100);
  input.firePointerDown();
  binding.poll();
  input._clearFrameState();
  input.firePointerUp();
  binding.poll();
  expect(session.inspect().command).toMatchObject({ target: target(100) });
  input._clearFrameState();
  input.firePointerDown();
  binding.poll();
  expect(model.worldPose("p1")).toEqual(target(100).pose);
  expect(session.inspect().command).toBeNull();
});

it("lets a projection reject hidden socket targets while retaining normal validation", () => {
  const { input, model, session, binding } = setup({
    project: (pose) => ({ pose, snap: false }),
  });
  model.commit({ kind: "place", type: "table", target: target(100) });
  session.select("lamp");
  input.firePointerMove(100, 100);
  input.firePointerDown();
  binding.poll();
  expect(session.inspect().command).toMatchObject({
    target: { pose: { x: 96, y: 96 } },
  });
  expect(
    session.inspect().preview?.issues.some((issue) => issue.code === "surface"),
  ).toBe(true);
  expect(model.snapshot().objects).toHaveLength(1);
});
