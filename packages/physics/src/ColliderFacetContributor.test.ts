import { describe, expect, it } from "vitest";
import {
  Engine,
  InspectorKey,
  Transform,
  installInspector,
} from "@yagejs/core";
import { ColliderComponent } from "./ColliderComponent.js";
import { ColliderFacetContributor } from "./ColliderFacetContributor.js";
import { PhysicsPlugin } from "./PhysicsPlugin.js";
import { scaleColliderPart } from "./colliderScale.js";
import type { ColliderPartConfig } from "./types.js";

const contributor = new ColliderFacetContributor();

describe("ColliderFacetContributor", () => {
  it("reports detached authored compound parts, sensors and subclasses without Rapier", () => {
    class DoorCollider extends ColliderComponent {}
    const collider = new DoorCollider({
      sensor: true,
      parts: [
        {
          shape: { type: "box", width: 100, height: 20 },
          offset: { x: 50, y: 10 },
        },
        {
          shape: {
            type: "polyline",
            vertices: [
              { x: 0, y: 0 },
              { x: 10, y: 30 },
            ],
          },
        },
      ],
    });
    expect(contributor.inspectComponent(collider)).toEqual({
      sensor: true,
      outlines: [
        {
          closed: true,
          vertices: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 20 },
            { x: 0, y: 20 },
          ],
        },
        {
          closed: false,
          vertices: [
            { x: 0, y: 0 },
            { x: 10, y: 30 },
          ],
        },
      ],
    });
    expect(collider._colliderHandles).toEqual([]);
    expect(contributor.inspectComponent(new Transform())).toBeUndefined();
  });

  it.each<ColliderPartConfig>([
    {
      shape: { type: "box", width: 40, height: 30, borderRadius: 5 },
      rotation: 0.3,
      offset: { x: 20, y: -10 },
    },
    { shape: { type: "circle", radius: 10 } },
    {
      shape: { type: "capsule", radius: 10, halfHeight: 20, axis: "x" },
      rotation: 0.5,
    },
    { shape: { type: "capsule", radius: 10, halfHeight: 20, axis: "y" } },
  ])(
    "uses the same outline as nonuniform collider scaling for $shape.type",
    (part) => {
      const collider = new ColliderComponent(part);
      const outline = contributor.inspectComponent(collider)!.outlines[0]!;
      const scaled = scaleColliderPart(part, -2, 3);
      expect(scaled.shape.type).toBe("polygon");
      if (scaled.shape.type !== "polygon") throw new Error("expected polygon");
      expect(
        outline.vertices.map(({ x, y }) => ({ x: x * -2, y: y * 3 })),
      ).toEqual(scaled.shape.vertices);
    },
  );

  it.each([
    {
      shape: { type: "capsule", radius: 100, halfHeight: 100 } as const,
      x: 100,
    },
    {
      shape: {
        type: "box",
        width: 400,
        height: 400,
        borderRadius: 100,
      } as const,
      x: 200,
    },
  ])(
    "preserves both endpoints of straight sides for $shape.type",
    ({ shape, x }) => {
      const outline = contributor.inspectComponent(
        new ColliderComponent({ shape }),
      )!.outlines[0]!;
      for (const sign of [-1, 1]) {
        for (const y of [-100, 100]) {
          expect(
            outline.vertices.some(
              (v) =>
                Math.abs(v.x - sign * x) < 1e-9 && Math.abs(v.y - y) < 1e-9,
            ),
          ).toBe(true);
        }
      }
    },
  );

  it("reports the convex footprint for concave and unordered polygon input", () => {
    const collider = new ColliderComponent({
      shape: {
        type: "polygon",
        vertices: [
          { x: 20, y: 20 },
          { x: 0, y: 0 },
          { x: 10, y: 5 },
          { x: 20, y: 0 },
          { x: 0, y: 20 },
        ],
      },
    });
    expect(
      contributor.inspectComponent(collider)?.outlines[0]?.vertices,
    ).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ]);
  });

  it("reads replacement shapes and sensor edits without exposing config objects", () => {
    const collider = new ColliderComponent({
      shape: { type: "box", width: 10, height: 20 },
    });
    const before = contributor.inspectComponent(collider)!;
    collider.setShape(
      { type: "box", width: 40, height: 20 },
      { offset: { x: 20, y: 10 } },
    );
    collider.setSensor(true);
    expect(contributor.inspectComponent(collider)).toEqual({
      sensor: true,
      outlines: [
        {
          closed: true,
          vertices: [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 20 },
            { x: 0, y: 20 },
          ],
        },
      ],
    });
    expect(before.sensor).toBe(false);
    expect(before.outlines[0]?.vertices[0]).toEqual({ x: -5, y: -10 });
  });

  it("registers through PhysicsPlugin at start and unregisters on plugin teardown", () => {
    const engine = new Engine();
    const plugin = new PhysicsPlugin();
    const component = new ColliderComponent({
      shape: { type: "circle", radius: 10 },
    });
    // The plugin installs before the Inspector exists, the order a game gets
    // when DebugPlugin (which installs the Inspector) is registered after it.
    plugin.install(engine.context);
    const removeInspector = installInspector(engine.context);
    const inspector = engine.context.resolve(InspectorKey);
    expect(inspector.getComponentFacet(component, "collider")).toBeUndefined();

    plugin.onStart();
    expect(
      inspector.getComponentFacet(component, "collider")?.outlines,
    ).toHaveLength(1);
    expect(
      inspector.getComponentFacet(new Transform(), "collider"),
    ).toBeUndefined();
    plugin.onDestroy();
    expect(inspector.getComponentFacet(component, "collider")).toBeUndefined();
    removeInspector();
  });

  it("starts without an Inspector", () => {
    const engine = new Engine();
    const plugin = new PhysicsPlugin();
    plugin.install(engine.context);
    expect(() => plugin.onStart()).not.toThrow();
    plugin.onDestroy();
  });
});
