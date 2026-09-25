/**
 * The point projection the UI test stand-ins for Pixi containers share:
 * translation and scale only, composed down a chain of parents. Rotation and
 * pivot are left out, so the numbers stay checkable by hand; a test that needs
 * them uses a real `Container` from `pixi.js`.
 *
 * Nothing here imports `pixi.js`, so a `vi.mock("pixi.js", …)` factory can
 * load it.
 */

/** The transform fields a stand-in container carries, the way Pixi names them. */
export interface AffineNode {
  readonly position: { readonly x: number; readonly y: number };
  readonly scale: { readonly x: number; readonly y: number };
  readonly parent: AffineNode | null;
}

interface Composed {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

/** A container's position and scale, composed from the root down. */
function compose(node: AffineNode | null | undefined): Composed {
  if (!node) return { x: 0, y: 0, scaleX: 1, scaleY: 1 };
  const outer = compose(node.parent);
  return {
    x: outer.x + node.position.x * outer.scaleX,
    y: outer.y + node.position.y * outer.scaleY,
    scaleX: outer.scaleX * node.scale.x,
    scaleY: outer.scaleY * node.scale.y,
  };
}

/**
 * Convert `point` — given in `from`'s local space, or in global space when
 * `from` is left out — into `target`'s local space. A container scaled to 0
 * has no inverse, and the result is not finite, as in Pixi.
 */
export function toLocalThrough(
  target: AffineNode,
  point: { x: number; y: number },
  from?: AffineNode,
  out?: { x: number; y: number },
): { x: number; y: number } {
  const source = compose(from);
  const into = compose(target);
  const result = out ?? { x: 0, y: 0 };
  result.x = (source.x + point.x * source.scaleX - into.x) / into.scaleX;
  result.y = (source.y + point.y * source.scaleY - into.y) / into.scaleY;
  return result;
}
