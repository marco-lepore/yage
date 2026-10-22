import { Entity, Transform, Vec2 } from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import { GridGraph } from "@yagejs/pathfinding";
import { PERCEPTIBLE_TAG } from "@yagejs-addons/perception";
import {
  ALLY_TAG,
  ARENA_TOP,
  COVER_WALL,
  GUARD_RADIUS,
  HEIGHT,
  NAV_TILE,
  SHADE_LAYER,
  SHADOW,
  TARGET_RADIUS,
  WIDTH,
} from "./constants.js";
import { SightLabelEntity } from "./overlays.js";

// ---------------------------------------------------------------------------
// WallEntity — static box that blocks movement and sight
// ---------------------------------------------------------------------------
export class WallEntity extends Entity {
  setup(params: { x: number; y: number; w: number; h: number }): void {
    const { x, y, w, h } = params;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({ shape: { type: "box", width: w, height: h } }),
    );
    this.add(
      new GraphicsComponent().draw((g) =>
        g.roundRect(-w / 2, -h / 2, w, h, Math.min(5, w / 2)).fill(0x687589),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Navigation — where the guard can stand, and the grid it walks on
// ---------------------------------------------------------------------------

/** Whether the guard, centered at `point`, clears the cover wall and the arena edges. */
export function guardFits(point: Vec2Like): boolean {
  const r = GUARD_RADIUS;
  if (point.x < r || point.x > WIDTH - r) return false;
  if (point.y < ARENA_TOP + r || point.y > HEIGHT - r) return false;
  const halfWidth = COVER_WALL.width / 2;
  const halfHeight = COVER_WALL.height / 2;
  const dx = Math.max(Math.abs(point.x - COVER_WALL.x) - halfWidth, 0);
  const dy = Math.max(Math.abs(point.y - COVER_WALL.y) - halfHeight, 0);
  return Math.hypot(dx, dy) >= r;
}

/**
 * Where the guard walks to reach `point`: `point` itself when its cell is
 * walkable, else the center of the nearest walkable cell up to two cells
 * away, else null.
 */
export function walkableGoal(grid: GridGraph, point: Vec2): Vec2 | null {
  const { col, row } = grid.worldToCell(point);
  if (guardFits(grid.cellToWorld(col, row))) return point;
  let nearest: Vec2 | null = null;
  for (let c = col - 2; c <= col + 2; c++) {
    for (let r = row - 2; r <= row + 2; r++) {
      const center = grid.cellToWorld(c, r);
      if (!guardFits(center)) continue;
      if (!nearest || center.distance(point) < nearest.distance(point))
        nearest = center;
    }
  }
  return nearest;
}

/** A cell is walkable when the guard fits at its center. */
export function createNavGrid(): GridGraph {
  return new GridGraph({
    cols: Math.ceil(WIDTH / NAV_TILE),
    rows: Math.ceil((HEIGHT - ARENA_TOP) / NAV_TILE),
    tileWidth: NAV_TILE,
    tileHeight: NAV_TILE,
    origin: { x: 0, y: ARENA_TOP },
    isWalkable: (col, row) =>
      guardFits({
        x: (col + 0.5) * NAV_TILE,
        y: ARENA_TOP + (row + 0.5) * NAV_TILE,
      }),
  });
}

// ---------------------------------------------------------------------------
// ShadowEntity — a dark patch that lowers the player's visibility
// ---------------------------------------------------------------------------

/** Whether a world point lies inside the shadow. Read by the guard's visibility check. */
export function inShadow(point: Vec2Like): boolean {
  return (
    point.x >= SHADOW.x &&
    point.x <= SHADOW.x + SHADOW.width &&
    point.y >= SHADOW.y &&
    point.y <= SHADOW.y + SHADOW.height
  );
}

/** Drawn on the shade layer, above the player, so standing in it looks dim. */
export class ShadowEntity extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(SHADOW.x, SHADOW.y) }));
    this.add(
      new GraphicsComponent({ layer: SHADE_LAYER }).draw((g) =>
        g
          .roundRect(0, 0, SHADOW.width, SHADOW.height, 10)
          .fill({ color: 0x05080d, alpha: 0.6 }),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// AllyEntity — a perceptible target the guard's eligibility check ignores
// ---------------------------------------------------------------------------
export class AllyEntity extends Entity {
  setup(params: { position: Vec2 }): void {
    this.tags.add(PERCEPTIBLE_TAG);
    this.tags.add(ALLY_TAG);
    this.add(new Transform({ position: params.position }));
    this.add(
      new GraphicsComponent().draw((g) =>
        g.circle(0, 0, TARGET_RADIUS).fill(0x9be38b),
      ),
    );
    this.spawnChild("sight-label", SightLabelEntity, { target: this });
  }
}
