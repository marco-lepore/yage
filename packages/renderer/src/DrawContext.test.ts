import { describe, expect, it } from "vitest";
import { Graphics } from "pixi.js";
import type { DrawContext } from "./DrawContext.js";

/** Every member of `DrawContext`. The type below fails when one is missing. */
const DRAWING = [
  "setFillStyle",
  "setStrokeStyle",
  "fill",
  "stroke",
  "texture",
  "beginPath",
  "cut",
  "arc",
  "arcTo",
  "arcToSvg",
  "bezierCurveTo",
  "closePath",
  "ellipse",
  "circle",
  "path",
  "lineTo",
  "moveTo",
  "quadraticCurveTo",
  "rect",
  "roundRect",
  "poly",
  "regularPoly",
  "roundPoly",
  "roundShape",
  "filletRect",
  "chamferRect",
  "star",
  "svg",
  "save",
  "restore",
  "getTransform",
  "resetTransform",
  "rotateTransform",
  "scaleTransform",
  "setTransform",
  "transform",
  "translateTransform",
  "clear",
] as const satisfies readonly (keyof DrawContext)[];

const coversEveryMember: Exclude<
  keyof DrawContext,
  (typeof DRAWING)[number]
> extends never
  ? true
  : false = true;

/**
 * Members of Pixi's `Graphics` that are not drawing: the display-object side,
 * the current style read back as Pixi's own type, and the drawing calls Pixi
 * keeps from v7 under other names.
 */
const NOT_DRAWING = new Set([
  "constructor",
  "context",
  "bounds",
  "updateBounds",
  "containsPoint",
  "destroy",
  "clone",
  "fillStyle",
  "strokeStyle",
  "lineStyle",
  "beginFill",
  "endFill",
  "drawCircle",
  "drawEllipse",
  "drawPolygon",
  "drawRect",
  "drawRoundedRect",
  "drawStar",
]);

describe("DrawContext", () => {
  it("lists every drawing member of Pixi's Graphics", () => {
    expect(coversEveryMember).toBe(true);
    const members = Object.getOwnPropertyNames(Graphics.prototype).filter(
      (name) => !name.startsWith("_") && !NOT_DRAWING.has(name),
    );
    // A Pixi upgrade that adds a drawing method fails here: add it to
    // `DrawContext`, or to `NOT_DRAWING` with a reason.
    expect([...members].sort()).toEqual([...DRAWING].sort());
  });

  it("is satisfied by a Pixi Graphics without wrapping it", () => {
    const graphics = new Graphics();
    const context: DrawContext = graphics;
    expect(context.rect(0, 0, 4, 4).fill(0xffffff)).toBe(graphics);
    // @ts-expect-error -- a drawing context has no children
    void context.addChild;
    graphics.destroy();
  });
});
