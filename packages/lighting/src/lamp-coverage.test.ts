/**
 * The lit share `LightingWorld` computes by projection, checked against the
 * same share counted one ray at a time. The reference builds its own geometry
 * from the shape, so a mistake in `occlusion.ts` cannot hide in both.
 */
import { createMockScene, Transform, Vec2 } from "@yagejs/core";
import { describe, expect, it } from "vitest";
import { LightOccluder } from "./LightOccluder.js";
import { LightSource } from "./LightSource.js";
import { LightingWorld } from "./LightingWorld.js";
import { LightingWorldKey } from "./types.js";
import type { LightOccluderShape } from "./types.js";

/** Rays cast across the lamp per case. */
const SAMPLES = 4001;
/**
 * Each end of a hidden stretch lands within one sample of its true place, and
 * a case has at most a handful of ends, so the counted share sits within a
 * few thousandths of the projected one.
 */
const TOLERANCE = 0.003;
/** Far enough that every sampled point stays inside every light. */
const LIGHT_RADIUS = 400;

interface Point {
  x: number;
  y: number;
}

/** Whether a segment meets a disc. */
function touchesDisc(
  from: Point,
  to: Point,
  center: Point,
  radius: number,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  let t = 0;
  if (lengthSquared > 0) {
    t = ((center.x - from.x) * dx + (center.y - from.y) * dy) / lengthSquared;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const offsetX = center.x - (from.x + t * dx);
  const offsetY = center.y - (from.y + t * dy);
  return offsetX * offsetX + offsetY * offsetY <= radius * radius;
}

/** Whether a closed outline covers a point. */
function outlineContains(outline: readonly Point[], point: Point): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const first = outline[i]!;
    const second = outline[j]!;
    if (
      first.y > point.y !== second.y > point.y &&
      point.x <
        ((second.x - first.x) * (point.y - first.y)) / (second.y - first.y) +
          first.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Whether two segments cross or touch. */
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (from: Point, to: Point, at: Point): number =>
    (to.x - from.x) * (at.y - from.y) - (to.y - from.y) * (at.x - from.x);
  const first = side(a, b, c);
  const second = side(a, b, d);
  const third = side(c, d, a);
  const fourth = side(c, d, b);
  return first * second <= 0 && third * fourth <= 0;
}

/** Whether a segment meets a closed outline. */
function touchesOutline(
  from: Point,
  to: Point,
  outline: readonly Point[],
): boolean {
  if (outlineContains(outline, to)) return true;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    if (segmentsCross(from, to, outline[j]!, outline[i]!)) return true;
  }
  return false;
}

/** The world-space outline of a box or polygon centred on the origin. */
function outlineOf(shape: LightOccluderShape): Point[] {
  switch (shape.type) {
    case "box": {
      const halfWidth = shape.width / 2;
      const halfHeight = shape.height / 2;
      return [
        { x: -halfWidth, y: -halfHeight },
        { x: halfWidth, y: -halfHeight },
        { x: halfWidth, y: halfHeight },
        { x: -halfWidth, y: halfHeight },
      ];
    }
    case "polygon":
      return shape.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
    case "circle":
      throw new Error("a circle has no outline in this reference");
  }
}

interface Sampled {
  /** Share of the lamp that reaches the point, from 0 to 1. */
  litShare: number;
  /** Whether part of the lamp itself lies inside the occluder. */
  crossesLamp: boolean;
}

/** Count the share of a lamp that reaches a point, one ray per sample. */
function sampleLitShare(
  point: Point,
  light: Point,
  halfSize: number,
  hits: (from: Point, to: Point) => boolean,
  covers: (at: Point) => boolean,
): Sampled {
  const dx = light.x - point.x;
  const dy = light.y - point.y;
  const distance = Math.hypot(dx, dy);
  const acrossX = -dy / distance;
  const acrossY = dx / distance;
  let lit = 0;
  let crossesLamp = false;
  for (let i = 0; i < SAMPLES; i++) {
    const offset = ((i / (SAMPLES - 1)) * 2 - 1) * halfSize;
    const at = {
      x: light.x + offset * acrossX,
      y: light.y + offset * acrossY,
    };
    if (covers(at)) crossesLamp = true;
    if (!hits(point, at)) lit++;
  }
  return { litShare: lit / SAMPLES, crossesLamp };
}

/** The lit share `LightingWorld` reports, read back out of the falloff. */
function queriedLitShare(
  shape: LightOccluderShape,
  light: Point,
  size: number,
  point: Point,
): number {
  const { scene } = createMockScene();
  const world = new LightingWorld(scene, { level: 0 });
  scene.registerScoped(LightingWorldKey, world);
  const lamp = scene.spawn("lamp");
  lamp.add(new Transform({ position: new Vec2(light.x, light.y) }));
  lamp.add(new LightSource({ radius: LIGHT_RADIUS, intensity: 1, size }));
  const blocker = scene.spawn("blocker");
  blocker.add(new Transform());
  blocker.add(new LightOccluder({ shape }));
  const distance = Math.hypot(point.x - light.x, point.y - light.y);
  return world.levelAt(point.x, point.y) / (1 - distance / LIGHT_RADIUS);
}

/** A repeatable number sequence, so a failure can be reproduced. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const CIRCLE: LightOccluderShape = { type: "circle", radius: 40 };
const BOX: LightOccluderShape = { type: "box", width: 60, height: 30 };
const ARROW: LightOccluderShape = {
  type: "polygon",
  vertices: [
    { x: -40, y: -30 },
    { x: 40, y: -30 },
    { x: 40, y: 30 },
    { x: 0, y: 0 },
    { x: -40, y: 30 },
  ],
};

interface Case {
  light: Point;
  point: Point;
  size: number;
}

/**
 * Lights close enough to the occluder that a wide lamp often runs through it,
 * with query points spread around the outside. `nearest` is how near a light
 * may stand; cases that put it inside the occluder are dropped later.
 */
function buildCases(seed: number, count: number, nearest: number): Case[] {
  const random = sequence(seed);
  const cases: Case[] = [];
  while (cases.length < count) {
    const lightAngle = random() * Math.PI * 2;
    const lightDistance = nearest + random() * 70;
    const pointAngle = random() * Math.PI * 2;
    const pointDistance = 80 + random() * 180;
    cases.push({
      light: {
        x: Math.cos(lightAngle) * lightDistance,
        y: Math.sin(lightAngle) * lightDistance,
      },
      point: {
        x: Math.cos(pointAngle) * pointDistance,
        y: Math.sin(pointAngle) * pointDistance,
      },
      size: 4 + random() * 76,
    });
  }
  return cases;
}

interface Comparison {
  /** One line per case whose two answers differ by more than the tolerance. */
  readonly apart: string[];
  /** Cases where part of the lamp lies inside the occluder. */
  readonly crossing: number;
  /** Cases compared, after dropping the ones the rule excludes. */
  readonly checked: number;
}

/** Compare both answers over a seeded set of light, lamp and point choices. */
function compare(
  shape: LightOccluderShape,
  hits: (from: Point, to: Point) => boolean,
  covers: (at: Point) => boolean,
  seed: number,
  nearest: number,
): Comparison {
  const apart: string[] = [];
  let crossing = 0;
  let checked = 0;
  for (const item of buildCases(seed, 150, nearest)) {
    // The light inside an occluder is a rule of its own: that occluder lets
    // the light out. A point inside one is dark for every light outside it.
    if (covers(item.light) || covers(item.point)) continue;
    checked++;
    const sampled = sampleLitShare(
      item.point,
      item.light,
      item.size / 2,
      hits,
      covers,
    );
    if (sampled.crossesLamp) crossing++;
    const queried = queriedLitShare(shape, item.light, item.size, item.point);
    if (Math.abs(queried - sampled.litShare) <= TOLERANCE) continue;
    apart.push(
      `light (${item.light.x.toFixed(1)}, ${item.light.y.toFixed(1)}) ` +
        `size ${item.size.toFixed(1)} ` +
        `point (${item.point.x.toFixed(1)}, ${item.point.y.toFixed(1)}): ` +
        `${queried.toFixed(4)} against ${sampled.litShare.toFixed(4)}`,
    );
  }
  return { apart, crossing, checked };
}

describe("lamp coverage against a sampled reference", () => {
  it("agrees for a lamp reaching into a disc", () => {
    // The lamp's far half is buried in the disc, and the silhouette chord
    // between the two grazing points sits entirely deeper than the lamp.
    const point = { x: -200, y: 80 };
    const light = { x: -42, y: 0 };
    const sampled = sampleLitShare(
      point,
      light,
      15,
      (from, to) => touchesDisc(from, to, { x: 0, y: 0 }, 40),
      (at) => Math.hypot(at.x, at.y) <= 40,
    );

    expect(sampled.crossesLamp).toBe(true);
    expect(
      Math.abs(queriedLitShare(CIRCLE, light, 30, point) - sampled.litShare),
    ).toBeLessThan(TOLERANCE);
  });

  it("agrees for a disc", () => {
    const result = compare(
      CIRCLE,
      (from, to) => touchesDisc(from, to, { x: 0, y: 0 }, 40),
      (at) => Math.hypot(at.x, at.y) <= 40,
      20260920,
      42,
    );

    expect(result.apart).toEqual([]);
    expect(result.checked).toBeGreaterThan(80);
    expect(result.crossing).toBeGreaterThan(10);
  });

  it("agrees for a box and a concave polygon", () => {
    for (const shape of [BOX, ARROW]) {
      const outline = outlineOf(shape);
      const result = compare(
        shape,
        (from, to) => touchesOutline(from, to, outline),
        (at) => outlineContains(outline, at),
        773311,
        18,
      );

      expect(result.apart).toEqual([]);
      expect(result.checked).toBeGreaterThan(80);
      expect(result.crossing).toBeGreaterThan(10);
    }
  });
});
