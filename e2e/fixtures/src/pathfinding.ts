/**
 * Deterministic e2e fixture for @yagejs/pathfinding.
 *
 * Boots a tiny scene with a fixed wall layout and one agent entity, and
 * exposes the `GridGraph` plus a `walkTo` command on `window.__pathfinding__`.
 * The spec computes paths directly against the grid (known start/goal →
 * known waypoints/cost) and drives the agent's movement through the frozen,
 * step-driven clock, reading its position back via the Inspector API.
 */

import { Engine, Scene, Component, Transform, Vec2 } from "@yagejs/core";
import { RendererPlugin, GraphicsComponent } from "@yagejs/renderer";
import { DebugPlugin } from "@yagejs/debug";
import { GridGraph, type Path } from "@yagejs/pathfinding";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();

const WIDTH = 200;
const HEIGHT = 100;
const COLS = 6;
const ROWS = 4;
const TILE = 20;
const AGENT_SPEED = 200; // px per second

// Vertical wall at col 3, rows 0-2; row 3 is the gap.
const WALLS = new Uint8Array(COLS * ROWS);
for (let row = 0; row < 3; row++) WALLS[row * COLS + 3] = 1;

const grid = new GridGraph({
  cols: COLS,
  rows: ROWS,
  tileWidth: TILE,
  tileHeight: TILE,
  isWalkable: (col, row) => WALLS[row * COLS + col] === 0,
  diagonalMovement: "never",
});

class AgentController extends Component {
  private path: Vec2[] = [];
  private index = 0;

  setPath(waypoints: Vec2[]): void {
    this.path = waypoints;
    this.index = 0;
  }

  isMoving(): boolean {
    return this.index < this.path.length;
  }

  update(dt: number): void {
    if (this.index >= this.path.length) return;
    const transform = this.entity.get(Transform);
    const target = this.path[this.index]!;
    const next = Vec2.moveTowards(transform.position, target, AGENT_SPEED * dt);
    transform.setPosition(next.x, next.y);
    if (next.x === target.x && next.y === target.y) this.index++;
  }
}

class PathfindingScene extends Scene {
  readonly name = "pathfinding-e2e";

  onEnter(): void {
    const agent = this.spawn("agent");
    agent.add(new Transform({ position: grid.cellToWorld(0, 0) }));
    agent.add(new GraphicsComponent().draw((g) => g.circle(0, 0, 5).fill({ color: 0x38bdf8 })));
    const controller = agent.add(new AgentController());

    (window as unknown as { __pathfinding__: unknown }).__pathfinding__ = {
      grid,
      walkTo(x: number, y: number): Path | null {
        const start = agent.get(Transform).position;
        const path = grid.findPath(start, new Vec2(x, y));
        if (path) controller.setPath(path.waypoints);
        return path;
      },
      isMoving: () => controller.isMoving(),
    };
  }
}

const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0a0a0a,
    resolution: 1,
    container: setupContainer(WIDTH, HEIGHT),
  }),
);
engine.use(new DebugPlugin());
await engine.start();
engine.inspector.time.freeze();
await engine.scenes.push(new PathfindingScene());
