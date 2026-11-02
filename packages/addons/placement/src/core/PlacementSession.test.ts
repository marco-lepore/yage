import { expect, it } from "vitest";
import { PlacementSession } from "./PlacementSession.js";
import { attached, layout, target } from "./fixtures.js";

it("keeps originals in place during moving and cancelling, and preserves a rejected draft", () => {
  const model = layout();
  model.commit({ kind: "place", type: "table", target: target(100) });
  model.commit({ kind: "place", type: "lamp", target: attached("p1") });
  const session = new PlacementSession(model);
  const before = model.snapshot();
  session.move("p1");
  session.aim({ x: 200, y: 200, rotation: 0 }, "room");
  expect(model.snapshot()).toBe(before);
  session.cancel();
  expect(model.snapshot()).toBe(before);
  session.move("p1");
  session.aim({ x: 0, y: 0, rotation: 0 }, "room");
  expect(session.confirm()?.ok).toBe(false);
  expect(session.inspect().command?.kind).toBe("move");
  expect(model.snapshot()).toBe(before);
});

it("snaps free and grid placements and rotates in radians", () => {
  const session = new PlacementSession(layout());
  session.select("table");
  session.aim({ x: 103, y: 97, rotation: 0 }, "room");
  expect(session.inspect().preview?.after.objects[0]?.pose).toEqual({
    x: 96,
    y: 96,
    rotation: 0,
  });
  session.aim({ x: 103, y: 97, rotation: 0 }, "room", { grid: 0 });
  session.rotate(Math.PI / 4);
  expect(session.confirm()?.ok).toBe(true);
  expect(session.model.worldPose("p1")).toEqual({
    x: 103,
    y: 97,
    rotation: Math.PI / 4,
  });
});

it("finds a compatible surface socket and excludes a moving parent and its descendants", () => {
  const model = layout();
  model.commit({ kind: "place", type: "table", target: target(100) });
  const session = new PlacementSession(model);
  session.select("lamp");
  session.aim({ x: 108, y: 100, rotation: 0 }, "room");
  expect(session.inspect().preview?.after.objects[1]?.attachment).toEqual({
    parent: "p1",
    socket: "top",
  });
  expect(session.confirm()?.ok).toBe(true);
  expect(model.worldPose("p2").x).toBe(108);
  session.move("p1");
  session.aim({ x: 100, y: 100, rotation: 0 }, "room", { grid: 0 });
  expect(
    session.inspect().preview?.after.objects[0]?.attachment,
  ).toBeUndefined();
});

it("converts world rotation to a fixed socket's local rotation", () => {
  const model = layout();
  model.commit({
    kind: "place",
    type: "table",
    target: target(100, 100, Math.PI / 2),
  });
  const session = new PlacementSession(model);
  session.select("wall");
  session.aim({ x: 100, y: 140, rotation: Math.PI / 4 }, "room");
  expect(session.confirm()?.ok).toBe(true);
  expect(model.worldPose("p2").rotation).toBeCloseTo(Math.PI / 4);
});
