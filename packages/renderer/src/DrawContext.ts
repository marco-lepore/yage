import type {
  ColorValue,
  DrawFill,
  DrawMatrix,
  DrawPath,
  DrawRoundedPoint,
  DrawStroke,
  PointLike,
  TextureResource,
} from "./public-types.js";

/**
 * What a drawing callback draws with: `GraphicsComponent.draw`,
 * `RendererPlugin.createTexture` and `graphicsMask` hand one to their
 * callback. It holds Pixi's drawing vocabulary and nothing else: shapes and
 * paths, `fill` and `stroke` with colours, gradients and textures, `cut`,
 * `clear`, and the transform stack with `save` / `restore`. Every call returns
 * the context, so calls chain.
 *
 * Where the drawing sits, how it turns and whether it shows belong to the
 * component and its entity's `Transform`, so the context has no position,
 * visibility or children.
 *
 * Each method behaves as Pixi `Graphics`' method of the same name; see the
 * Pixi graphics guide for the details of each.
 */
export interface DrawContext {
  /** Set the style the next `fill()` without arguments uses. */
  setFillStyle(style: DrawFill): this;
  /** Set the style the next `stroke()` without arguments uses. */
  setStrokeStyle(style: DrawStroke): this;
  /** Fill the current path. */
  fill(style?: DrawFill): this;
  fill(color: ColorValue, alpha?: number): this;
  /** Stroke the current path. */
  stroke(style?: DrawStroke): this;
  /** Draw a texture at the origin, or into the box `dx, dy, dw, dh`. */
  texture(
    texture: TextureResource,
    tint?: ColorValue,
    dx?: number,
    dy?: number,
    dw?: number,
    dh?: number,
  ): this;
  /** Start a new path, dropping the current one. */
  beginPath(): this;
  /** Cut the current path out of the shape drawn before it, as a hole. */
  cut(): this;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): this;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): this;
  arcToSvg(
    rx: number,
    ry: number,
    xAxisRotation: number,
    largeArcFlag: number,
    sweepFlag: number,
    x: number,
    y: number,
  ): this;
  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
    smoothness?: number,
  ): this;
  closePath(): this;
  ellipse(x: number, y: number, radiusX: number, radiusY: number): this;
  circle(x: number, y: number, radius: number): this;
  /** Add a prepared path. */
  path(path: DrawPath): this;
  lineTo(x: number, y: number): this;
  moveTo(x: number, y: number): this;
  quadraticCurveTo(
    cpx: number,
    cpy: number,
    x: number,
    y: number,
    smoothness?: number,
  ): this;
  rect(x: number, y: number, w: number, h: number): this;
  roundRect(x: number, y: number, w: number, h: number, radius?: number): this;
  poly(points: number[] | PointLike[], close?: boolean): this;
  regularPoly(
    x: number,
    y: number,
    radius: number,
    sides: number,
    rotation?: number,
    transform?: DrawMatrix,
  ): this;
  roundPoly(
    x: number,
    y: number,
    radius: number,
    sides: number,
    corner: number,
    rotation?: number,
  ): this;
  roundShape(
    points: DrawRoundedPoint[],
    radius: number,
    useQuadratic?: boolean,
    smoothness?: number,
  ): this;
  filletRect(
    x: number,
    y: number,
    width: number,
    height: number,
    fillet: number,
  ): this;
  chamferRect(
    x: number,
    y: number,
    width: number,
    height: number,
    chamfer: number,
    transform?: DrawMatrix,
  ): this;
  star(
    x: number,
    y: number,
    points: number,
    radius: number,
    innerRadius?: number,
    rotation?: number,
  ): this;
  /** Draw the shapes an SVG string describes. */
  svg(svg: string): this;
  /** Push the current transform and styles, for a later `restore()`. */
  save(): this;
  /** Pop the transform and styles the last `save()` pushed. */
  restore(): this;
  /** The transform applied to the next shapes. */
  getTransform(): DrawMatrix;
  resetTransform(): this;
  rotateTransform(angle: number): this;
  scaleTransform(x: number, y?: number): this;
  setTransform(transform: DrawMatrix): this;
  setTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    dx: number,
    dy: number,
  ): this;
  transform(transform: DrawMatrix): this;
  transform(
    a: number,
    b: number,
    c: number,
    d: number,
    dx: number,
    dy: number,
  ): this;
  translateTransform(x: number, y?: number): this;
  /** Erase everything drawn so far. */
  clear(): this;
}
