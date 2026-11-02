import { expect, it, vi } from "vitest";
import { createMockEntity, Transform } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import { GraphicsComponent, SceneRenderTreeKey } from "@yagejs/renderer";
import type { SceneRenderTree } from "@yagejs/renderer";
import { PlacementController } from "./PlacementController.js";
import { PlacementLayoutView, PlacementPreviewView } from "./presenters.js";
import { layout, target } from "./core/fixtures.js";

function graphicsBelow(host: Entity): Entity[] {
  return [...host.children.values()].flatMap((child) => [
    ...(child.has(GraphicsComponent) ? [child] : []),
    ...graphicsBelow(child),
  ]);
}

it("keeps world drawings independent of the host transform across disable, re-enable and teardown", () => {
  const { entity, scene } = createMockEntity();
  const hostTransform = entity.add(
    new Transform({
      position: { x: 100, y: 50 },
      rotation: 0.5,
      scale: { x: 2, y: 3 },
    }),
  );
  const layer = { container: { addChild: vi.fn() } };
  const ensureLayer = vi.fn(() => layer);
  scene.registerScoped(SceneRenderTreeKey, {
    ensureLayer,
    tryGet: () => layer,
    defaultLayer: layer,
  } as unknown as SceneRenderTree);
  const model = layout();
  model.commit({ kind: "place", type: "table", target: target(100) });
  const controller = entity.add(
    new PlacementController({
      model,
      input: null,
      layout: new PlacementLayoutView(),
      preview: new PlacementPreviewView(),
    }),
  );
  controller.editor.move("p1");
  controller.editor.aim({ x: 200, y: 200, rotation: 0 }, "room");
  controller.update();

  const first = graphicsBelow(entity);
  expect(first).toHaveLength(2);
  for (const drawing of first) {
    const transform = drawing.get(Transform);
    expect(transform.worldPosition).toMatchObject({ x: 0, y: 0 });
    expect(transform.worldRotation).toBe(0);
    expect(transform.worldScale).toMatchObject({ x: 1, y: 1 });
    expect(drawing.get(GraphicsComponent).localBounds.width).toBeGreaterThan(0);
  }
  hostTransform.setPosition(350, 250);
  hostTransform.setRotation(1.2);
  for (const drawing of first) {
    expect(drawing.get(Transform).worldPosition).toMatchObject({ x: 0, y: 0 });
    expect(drawing.get(Transform).worldRotation).toBe(0);
  }

  controller.enabled = false;
  expect(graphicsBelow(entity)).toEqual([]);
  expect(first.every((drawing) => drawing.isDestroyed)).toBe(true);
  expect(controller.inspection?.command).toBeNull();
  controller.enabled = true;
  controller.update();
  const second = graphicsBelow(entity);
  expect(second).toHaveLength(2);
  expect(second.every((drawing) => !first.includes(drawing))).toBe(true);
  expect(second.every((drawing) => !drawing.isDestroyed)).toBe(true);
  expect(ensureLayer).toHaveBeenCalledTimes(4);
  scene._flushDestroyQueue();
  expect(second.every((drawing) => !drawing.isDestroyed)).toBe(true);
  controller.destroy();
  expect(second.every((drawing) => drawing.isDestroyed)).toBe(true);
  scene._flushDestroyQueue();
  expect(graphicsBelow(entity)).toEqual([]);
  expect(model.snapshot().objects).toHaveLength(1);
});
