import "pixi.js/events";
import { Container, EventBoundary, Rectangle } from "pixi.js";
import { describe, expect, it } from "vitest";
import { synchronizeInteraction } from "./drawing.js";

describe("drawing without rasterization", () => {
  it("keeps moved, reparented and reordered targets current without drawing", () => {
    const stage = new Container();
    const parent = stage.addChild(new Container());
    parent.sortableChildren = true;
    const first = parent.addChild(
      new Container({
        eventMode: "static",
        hitArea: new Rectangle(0, 0, 20, 20),
      }),
    );
    const second = parent.addChild(
      new Container({
        eventMode: "static",
        hitArea: new Rectangle(0, 0, 20, 20),
      }),
    );
    const boundary = new EventBoundary(stage);
    synchronizeInteraction(stage);
    expect(boundary.hitTest(5, 5)).toBe(second);
    parent.x = 100;
    first.zIndex = 2;
    synchronizeInteraction(stage);
    expect(boundary.hitTest(5, 5)).toBeNull();
    expect(boundary.hitTest(105, 5)).toBe(first);
    const next = stage.addChild(new Container({ isRenderGroup: true }));
    next.x = 200;
    next.addChild(first);
    synchronizeInteraction(stage);
    expect(boundary.hitTest(205, 5)).toBe(first);
    expect(boundary.hitTest(105, 5)).toBe(second);
    expect(stage.visible).toBe(true);
  });
});
