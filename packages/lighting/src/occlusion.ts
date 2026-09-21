import { Vec2Buffer } from "@yagejs/core";
import type { LightOccluder } from "./LightOccluder.js";
import type { LightOccluderShape } from "./types.js";

/** Vertices that outline a circle whose entity scale is not uniform. */
const CIRCLE_OUTLINE_VERTICES = 32;

/**
 * Squared world distance within which a point counts as sitting on an outline
 * edge. A thousandth of a pixel: far below anything a game positions by, and
 * far above the rounding a rotated or scaled shape leaves behind.
 */
const ON_EDGE_TOLERANCE_SQUARED = 1e-6;

/**
 * Nearest depth, in world pixels from the query point, at which an occluder
 * edge still projects onto the lamp. An edge closer than that runs through the
 * point itself, where the projection is unbounded and the clamp to the lamp's
 * own ends answers instead.
 */
const MIN_PROJECTION_DEPTH = 1e-3;

/**
 * @internal Footprints for a whole occluder set, resolved once and then read
 * many times. The query and the renderer both work from one of these, so the
 * light a game asks about and the light it sees come from the same geometry.
 */
export class OccluderFootprintPool {
  private readonly scratch = new Vec2Buffer();
  private readonly footprints: OccluderFootprint[] = [];
  /** How many entries the last {@link refresh} filled. */
  count = 0;

  /** Re-read every occluder's current world transform and shape. */
  refresh(occluders: Iterable<LightOccluder>): void {
    let count = 0;
    for (const occluder of occluders) {
      const footprint = (this.footprints[count] ??= new OccluderFootprint());
      footprint.resolve(occluder, this.scratch);
      count++;
    }
    this.count = count;
  }

  /** The footprint at `index`, valid while `index` is below {@link count}. */
  get(index: number): OccluderFootprint {
    return this.footprints[index]!;
  }
}

/**
 * @internal A lamp of a given width, seen from one query point.
 *
 * The lamp is a line of width `2 * halfSize` centred on the light and square
 * to the direction from the point to it. Coordinates along that line run from
 * -1 at one end to 1 at the other, and each occluder edge hides a stretch of
 * it. Overlapping stretches merge, so two blockers covering the same part of
 * the lamp take it away once.
 *
 * One view is aimed at each light in turn from each point, so the direction,
 * the depth and the bounds are worked out once and every footprint reads them.
 */
export class LampView {
  /** World point the lamp is seen from. */
  pointX = 0;
  pointY = 0;
  /** Smallest world rectangle holding the point and the whole lamp. */
  minX = 0;
  minY = 0;
  maxX = 0;
  maxY = 0;
  /** Unit direction from the point towards the light. */
  private alongX = 1;
  private alongY = 0;
  /** World centre of the lamp's line. */
  private lightX = 0;
  private lightY = 0;
  /** Distance to the light, which is the depth the lamp's line sits at. */
  private distance = 0;
  private halfSize = 0;
  private readonly starts: number[] = [];
  private readonly ends: number[] = [];
  private count = 0;

  /**
   * Point this view at a light from a query point, dropping what the last
   * point hid. Returns `false` for a point standing on the light itself,
   * which has no direction to project along and sees the whole lamp.
   */
  aimAt(
    pointX: number,
    pointY: number,
    lightX: number,
    lightY: number,
    halfSize: number,
  ): boolean {
    this.count = 0;
    const toLightX = lightX - pointX;
    const toLightY = lightY - pointY;
    const distance = Math.hypot(toLightX, toLightY);
    if (distance === 0) return false;
    this.pointX = pointX;
    this.pointY = pointY;
    this.alongX = toLightX / distance;
    this.alongY = toLightY / distance;
    this.lightX = lightX;
    this.lightY = lightY;
    this.distance = distance;
    this.halfSize = halfSize;
    // The lamp reaches at most its own half-width from the light, in any
    // direction, so this rectangle holds every ray the point can send it.
    this.minX = Math.min(pointX, lightX - halfSize);
    this.maxX = Math.max(pointX, lightX + halfSize);
    this.minY = Math.min(pointY, lightY - halfSize);
    this.maxY = Math.max(pointY, lightY + halfSize);
    return true;
  }

  /** Whether the whole lamp is hidden, so no further edge can change it. */
  get blocked(): boolean {
    return this.count === 1 && this.starts[0]! <= -1 && this.ends[0]! >= 1;
  }

  /** Share of the lamp's width that nothing hides, from 0 to 1. */
  get litShare(): number {
    let hidden = 0;
    for (let i = 0; i < this.count; i++) {
      hidden += this.ends[i]! - this.starts[i]!;
    }
    return Math.max(0, 1 - hidden / 2);
  }

  /** Take the whole lamp away, for a point an occluder covers outright. */
  hideAll(): void {
    this.count = 1;
    this.starts[0] = -1;
    this.ends[0] = 1;
  }

  /**
   * Hide the stretch of the lamp that one occluder edge takes away.
   *
   * The edge is first clipped to the depth between the point and the lamp —
   * anything nearer than the point or beyond the lamp hides nothing — and each
   * surviving end is then carried along its own ray out to the lamp's depth,
   * which is where it stops light.
   */
  hide(ax: number, ay: number, bx: number, by: number): void {
    const alongX = this.alongX;
    const alongY = this.alongY;
    const distance = this.distance;
    const firstX = ax - this.pointX;
    const firstY = ay - this.pointY;
    const secondX = bx - this.pointX;
    const secondY = by - this.pointY;
    const firstDepth = firstX * alongX + firstY * alongY;
    const secondDepth = secondX * alongX + secondY * alongY;
    if (
      (firstDepth < MIN_PROJECTION_DEPTH &&
        secondDepth < MIN_PROJECTION_DEPTH) ||
      (firstDepth > distance && secondDepth > distance)
    ) {
      return;
    }
    const firstSide = firstY * alongX - firstX * alongY;
    const secondSide = secondY * alongX - secondX * alongY;

    let from = 0;
    let to = 1;
    const depthSpan = secondDepth - firstDepth;
    if (depthSpan !== 0) {
      const atNear = (MIN_PROJECTION_DEPTH - firstDepth) / depthSpan;
      const atFar = (distance - firstDepth) / depthSpan;
      from = Math.max(from, Math.min(atNear, atFar));
      to = Math.min(to, Math.max(atNear, atFar));
      if (from > to) return;
    }

    // An end at depth `d` and offset `s` from the line to the light meets the
    // lamp `s * distance / d` off its centre; dividing by the lamp's own
    // half-width puts that on the -1 to 1 scale.
    const scale = distance / this.halfSize;
    const fromDepth = firstDepth + depthSpan * from;
    const fromSide = firstSide + (secondSide - firstSide) * from;
    const toDepth = firstDepth + depthSpan * to;
    const toSide = firstSide + (secondSide - firstSide) * to;
    const fromEnd = (fromSide / fromDepth) * scale;
    const toEnd = (toSide / toDepth) * scale;
    this.add(
      Math.max(-1, Math.min(fromEnd, toEnd)),
      Math.min(1, Math.max(fromEnd, toEnd)),
    );
  }

  /**
   * Hide the stretch a disc takes, for a query point outside it.
   *
   * The disc's silhouette from the point is the chord between the two points
   * where the view of it grazes the outline. Where the lamp's own line runs
   * through the disc that chord can sit entirely beyond the lamp, hiding
   * nothing by itself, while lamp points inside the disc are hidden outright.
   * The chord between the two places the lamp's line meets the outline covers
   * those, and the two chords together bound the hidden stretch in every
   * arrangement of disc and lamp.
   */
  hideDisc(centerX: number, centerY: number, radius: number): void {
    const pointX = this.pointX;
    const pointY = this.pointY;
    const toCenterX = centerX - pointX;
    const toCenterY = centerY - pointY;
    const centerDistance = Math.hypot(toCenterX, toCenterY);
    const sin = radius / centerDistance;
    const cos = Math.sqrt(Math.max(0, 1 - sin * sin));
    const reach = centerDistance * cos;
    const unitX = toCenterX / centerDistance;
    const unitY = toCenterY / centerDistance;
    this.hide(
      pointX + reach * (unitX * cos - unitY * sin),
      pointY + reach * (unitX * sin + unitY * cos),
      pointX + reach * (unitX * cos + unitY * sin),
      pointY + reach * (unitY * cos - unitX * sin),
    );

    // The lamp's line is square to `along`, so its own points are the ones at
    // offset `t` from the light. Both ends of the chord already sit on the
    // lamp, so their offsets are their coordinates along it.
    const offsetX = this.lightX - centerX;
    const offsetY = this.lightY - centerY;
    const acrossX = -this.alongY;
    const acrossY = this.alongX;
    const midpoint = -(offsetX * acrossX + offsetY * acrossY);
    const halfChordSquared =
      midpoint * midpoint -
      (offsetX * offsetX + offsetY * offsetY) +
      radius * radius;
    if (halfChordSquared <= 0) return;
    const halfChord = Math.sqrt(halfChordSquared);
    const scale = 1 / this.halfSize;
    this.add(
      Math.max(-1, (midpoint - halfChord) * scale),
      Math.min(1, (midpoint + halfChord) * scale),
    );
  }

  /** Record one hidden stretch, merged into the ones it meets. */
  private add(start: number, end: number): void {
    if (!(end > start)) return;
    const starts = this.starts;
    const ends = this.ends;
    let first = 0;
    while (first < this.count && ends[first]! < start) first++;
    let last = first;
    let low = start;
    let high = end;
    while (last < this.count && starts[last]! <= high) {
      if (starts[last]! < low) low = starts[last]!;
      if (ends[last]! > high) high = ends[last]!;
      last++;
    }
    const merged = last - first;
    if (merged > 1) {
      const removed = merged - 1;
      for (let i = last; i < this.count; i++) {
        starts[i - removed] = starts[i]!;
        ends[i - removed] = ends[i]!;
      }
      this.count -= removed;
    } else if (merged === 0) {
      for (let i = this.count; i > first; i--) {
        starts[i] = starts[i - 1]!;
        ends[i] = ends[i - 1]!;
      }
      this.count++;
    }
    starts[first] = low;
    ends[first] = high;
  }
}

/**
 * @internal One occluder's world-space footprint, resolved from its component
 * once and then reused across every light and every sampled point of a query.
 *
 * A circle under a uniform positive entity scale stays a circle; every other
 * shape becomes a world-space polygon. That is the rule a physics collider
 * follows, so a scaled wall shadows the area it collides over.
 */
export class OccluderFootprint {
  /** Whether the footprint is a circle; otherwise {@link vertices} holds it. */
  isCircle = false;
  centerX = 0;
  centerY = 0;
  radius = 0;
  /** World-space outline as flat `x, y` pairs. */
  vertices = new Float64Array(CIRCLE_OUTLINE_VERTICES * 2);
  vertexCount = 0;
  minX = 0;
  minY = 0;
  maxX = 0;
  maxY = 0;

  /** Read one occluder's current world transform and shape into this buffer. */
  resolve(occluder: LightOccluder, scratch: Vec2Buffer): void {
    const position = occluder.getPositionInto(scratch);
    const originX = position.x;
    const originY = position.y;
    const scale = occluder.scale;
    const scaleX = scale.x;
    const scaleY = scale.y;
    const shape = occluder.shape;

    if (shape.type === "circle" && scaleX > 0 && scaleX === scaleY) {
      const radius = shape.radius * scaleX;
      this.isCircle = true;
      this.centerX = originX;
      this.centerY = originY;
      this.radius = radius;
      this.minX = originX - radius;
      this.minY = originY - radius;
      this.maxX = originX + radius;
      this.maxY = originY + radius;
      return;
    }

    this.isCircle = false;
    const count = this.writeLocalOutline(shape, scaleX, scaleY);
    this.vertexCount = count;

    const rotation = occluder.rotation;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const vertices = this.vertices;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      const offset = i * 2;
      const localX = vertices[offset]!;
      const localY = vertices[offset + 1]!;
      const x = originX + localX * cos - localY * sin;
      const y = originY + localX * sin + localY * cos;
      vertices[offset] = x;
      vertices[offset + 1] = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
  }

  /** Whether the closed footprint covers a point. */
  contains(x: number, y: number): boolean {
    if (x < this.minX || x > this.maxX || y < this.minY || y > this.maxY) {
      return false;
    }
    if (this.isCircle) {
      const dx = x - this.centerX;
      const dy = y - this.centerY;
      return dx * dx + dy * dy <= this.radius * this.radius;
    }
    const vertices = this.vertices;
    const count = this.vertexCount;
    let inside = false;
    for (let i = 0, j = count - 1; i < count; j = i++) {
      const ix = vertices[i * 2]!;
      const iy = vertices[i * 2 + 1]!;
      const jx = vertices[j * 2]!;
      const jy = vertices[j * 2 + 1]!;
      // The outline belongs to the footprint, so a light resting against a
      // wall counts as inside it and that wall lets it through. The crossing
      // count below answers the interior and reads a point on an edge as
      // either side of it.
      if (
        segmentPointDistanceSquared(jx, jy, ix, iy, x, y) <=
        ON_EDGE_TOLERANCE_SQUARED
      ) {
        return true;
      }
      if (iy > y !== jy > y && x < ((jx - ix) * (y - iy)) / (jy - iy) + ix) {
        inside = !inside;
      }
    }
    return inside;
  }

  /** Whether the footprint is near enough to shadow anything a light reaches. */
  withinRange(x: number, y: number, radius: number): boolean {
    const dx =
      x < this.minX ? this.minX - x : x > this.maxX ? x - this.maxX : 0;
    const dy =
      y < this.minY ? this.minY - y : y > this.maxY ? y - this.maxY : 0;
    return dx * dx + dy * dy <= radius * radius;
  }

  /** Whether the closed footprint touches the segment. */
  blocks(x1: number, y1: number, x2: number, y2: number): boolean {
    // A point queried at a light's own position gives a segment with no
    // direction, which the edge tests below cannot read. It meets the
    // footprint exactly when the footprint covers it.
    if (x1 === x2 && y1 === y2) return this.contains(x2, y2);
    if (
      Math.max(x1, x2) < this.minX ||
      Math.min(x1, x2) > this.maxX ||
      Math.max(y1, y2) < this.minY ||
      Math.min(y1, y2) > this.maxY
    ) {
      return false;
    }
    if (this.isCircle) {
      const radius = this.radius;
      return (
        segmentPointDistanceSquared(
          x1,
          y1,
          x2,
          y2,
          this.centerX,
          this.centerY,
        ) <=
        radius * radius
      );
    }
    if (this.contains(x2, y2)) return true;
    const vertices = this.vertices;
    const count = this.vertexCount;
    for (let i = 0, j = count - 1; i < count; j = i++) {
      if (
        segmentsTouch(
          x1,
          y1,
          x2,
          y2,
          vertices[j * 2]!,
          vertices[j * 2 + 1]!,
          vertices[i * 2]!,
          vertices[i * 2 + 1]!,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Hide the stretch of a lamp this footprint takes from the view's point.
   *
   * A circle is handled as a disc; every other shape projects each edge of
   * its outline. The union of those stretches is the part of the lamp whose
   * straight line back to the point crosses the footprint, which is what
   * `blocks()` answers for a point lamp.
   */
  projectShadow(lamp: LampView): void {
    if (
      this.maxX < lamp.minX ||
      this.minX > lamp.maxX ||
      this.maxY < lamp.minY ||
      this.minY > lamp.maxY
    ) {
      return;
    }
    const pointX = lamp.pointX;
    const pointY = lamp.pointY;
    // A point inside an occluder is dark for every light outside it.
    if (this.contains(pointX, pointY)) {
      lamp.hideAll();
      return;
    }

    if (this.isCircle) {
      lamp.hideDisc(this.centerX, this.centerY, this.radius);
      return;
    }

    const vertices = this.vertices;
    const count = this.vertexCount;
    for (let i = 0, j = count - 1; i < count; j = i++) {
      lamp.hide(
        vertices[j * 2]!,
        vertices[j * 2 + 1]!,
        vertices[i * 2]!,
        vertices[i * 2 + 1]!,
      );
      if (lamp.blocked) return;
    }
  }

  /** Write the shape's scaled outline in entity-local pixels; returns its length. */
  private writeLocalOutline(
    shape: LightOccluderShape,
    scaleX: number,
    scaleY: number,
  ): number {
    switch (shape.type) {
      case "circle": {
        const vertices = this.ensureCapacity(CIRCLE_OUTLINE_VERTICES);
        for (let i = 0; i < CIRCLE_OUTLINE_VERTICES; i++) {
          const angle = (i / CIRCLE_OUTLINE_VERTICES) * Math.PI * 2;
          vertices[i * 2] = Math.cos(angle) * shape.radius * scaleX;
          vertices[i * 2 + 1] = Math.sin(angle) * shape.radius * scaleY;
        }
        return CIRCLE_OUTLINE_VERTICES;
      }
      case "box": {
        const halfWidth = (shape.width / 2) * scaleX;
        const halfHeight = (shape.height / 2) * scaleY;
        const vertices = this.ensureCapacity(4);
        vertices[0] = -halfWidth;
        vertices[1] = -halfHeight;
        vertices[2] = halfWidth;
        vertices[3] = -halfHeight;
        vertices[4] = halfWidth;
        vertices[5] = halfHeight;
        vertices[6] = -halfWidth;
        vertices[7] = halfHeight;
        return 4;
      }
      case "polygon": {
        const source = shape.vertices;
        const vertices = this.ensureCapacity(source.length);
        for (let i = 0; i < source.length; i++) {
          vertices[i * 2] = source[i]!.x * scaleX;
          vertices[i * 2 + 1] = source[i]!.y * scaleY;
        }
        return source.length;
      }
    }
  }

  private ensureCapacity(vertexCount: number): Float64Array {
    if (this.vertices.length < vertexCount * 2) {
      this.vertices = new Float64Array(vertexCount * 2);
    }
    return this.vertices;
  }
}

/** Squared distance from a point to the closest point on a segment. */
function segmentPointDistanceSquared(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  px: number,
  py: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  let t = 0;
  if (lengthSquared > 0) {
    t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  const offsetX = px - closestX;
  const offsetY = py - closestY;
  return offsetX * offsetX + offsetY * offsetY;
}

/**
 * Whether two closed segments share at least one point. Grazing a corner
 * counts, so two occluders that meet at an edge leave no gap for light.
 */
function segmentsTouch(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const abx = bx - ax;
  const aby = by - ay;
  const cdx = dx - cx;
  const cdy = dy - cy;
  const d1 = abx * (cy - ay) - aby * (cx - ax);
  const d2 = abx * (dy - ay) - aby * (dx - ax);
  if (d1 === 0 && d2 === 0) {
    // Collinear: they meet only where their bounding boxes overlap.
    return (
      Math.min(ax, bx) <= Math.max(cx, dx) &&
      Math.min(cx, dx) <= Math.max(ax, bx) &&
      Math.min(ay, by) <= Math.max(cy, dy) &&
      Math.min(cy, dy) <= Math.max(ay, by)
    );
  }
  const d3 = cdx * (ay - cy) - cdy * (ax - cx);
  const d4 = cdx * (by - cy) - cdy * (bx - cx);
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}

/** One occluder's world transform, compared per frame to catch a move. */
interface OccluderState {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/**
 * @internal One scene's occluders as a renderer sees them: a revision number
 * that changes whenever the set or any occluder's world transform does, and
 * the footprints behind it, resolved at most once a frame.
 *
 * A renderer rebuilds a light's shadow geometry when the revision it last drew
 * from is stale, so a still scene redraws nothing.
 */
export class OccluderWatch {
  private readonly pool = new OccluderFootprintPool();
  private readonly states = new Map<LightOccluder, OccluderState>();
  private readonly scratch = new Vec2Buffer();
  private occluders: Iterable<LightOccluder> = [];
  private resolved = false;
  private _revision = 0;

  /** Changes whenever an occluder appears, moves, rescales, turns or leaves. */
  get revision(): number {
    return this._revision;
  }

  /** Re-read the set for this frame. Call once, before the lights are drawn. */
  sync(occluders: ReadonlySet<LightOccluder>): void {
    this.occluders = occluders;
    this.resolved = false;
    let changed = false;
    for (const occluder of this.states.keys()) {
      if (occluders.has(occluder)) continue;
      this.states.delete(occluder);
      changed = true;
    }
    for (const occluder of occluders) {
      const position = occluder.getPositionInto(this.scratch);
      const scale = occluder.scale;
      const rotation = occluder.rotation;
      const state = this.states.get(occluder);
      if (!state) {
        this.states.set(occluder, {
          x: position.x,
          y: position.y,
          rotation,
          scaleX: scale.x,
          scaleY: scale.y,
        });
        changed = true;
        continue;
      }
      if (
        state.x === position.x &&
        state.y === position.y &&
        state.rotation === rotation &&
        state.scaleX === scale.x &&
        state.scaleY === scale.y
      ) {
        continue;
      }
      state.x = position.x;
      state.y = position.y;
      state.rotation = rotation;
      state.scaleX = scale.x;
      state.scaleY = scale.y;
      changed = true;
    }
    if (changed) this._revision++;
  }

  /** How many footprints the synced set holds, resolving them if needed. */
  footprintCount(): number {
    if (!this.resolved) {
      this.pool.refresh(this.occluders);
      this.resolved = true;
    }
    return this.pool.count;
  }

  /** The footprint at `index`, valid below {@link footprintCount}. */
  get(index: number): OccluderFootprint {
    return this.pool.get(index);
  }

  /** Forget every tracked occluder, for a renderer being torn down. */
  clear(): void {
    this.states.clear();
    this.occluders = [];
    this.resolved = false;
  }
}
