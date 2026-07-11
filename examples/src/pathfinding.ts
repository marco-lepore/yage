import { Engine, Scene, Entity, Component, Transform, Vec2 } from "@yagejs/core";
import { RendererPlugin, GraphicsComponent } from "@yagejs/renderer";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import { GridGraph, type Path } from "@yagejs/pathfinding";
import { injectStyles, setupGameContainer } from "./shared.js";

injectStyles();

const WIDTH = 800;
const HEIGHT = 600;
const TILE = 40;
const COLS = WIDTH / TILE;
const ROWS = HEIGHT / TILE;
const AGENT_SPEED = 220; // px per second

// A vertical wall with a single gap near the bottom.
const WALLS = new Uint8Array(COLS * ROWS);
for (let row = 1; row < ROWS - 2; row++) {
  WALLS[row * COLS + 10] = 1;
}

const grid = new GridGraph({
  cols: COLS,
  rows: ROWS,
  tileWidth: TILE,
  tileHeight: TILE,
  isWalkable: (col, row) => WALLS[row * COLS + col] === 0,
});

// ---------------------------------------------------------------------------
// AgentController — walks the current path's waypoints in order
// ---------------------------------------------------------------------------
class AgentController extends Component {
  private path: Vec2[] = [];
  private index = 0;

  setPath(waypoints: Vec2[]): void {
    this.path = waypoints;
    this.index = 0;
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

class AgentEntity extends Entity {
  setup(): void {
    this.add(new Transform({ position: grid.cellToWorld(0, 0) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 10).fill({ color: 0x38bdf8 });
        g.circle(0, 0, 10).stroke({ color: 0x0ea5e9, width: 2 });
      }),
    );
    this.add(new AgentController());
  }
}

// ---------------------------------------------------------------------------
// GridEntity — draws the static grid lines and wall tiles once
// ---------------------------------------------------------------------------
class GridEntity extends Entity {
  setup(): void {
    this.add(new Transform());
    this.add(
      new GraphicsComponent().draw((g) => {
        for (let row = 0; row < ROWS; row++) {
          for (let col = 0; col < COLS; col++) {
            if (WALLS[row * COLS + col] === 1) {
              g.rect(col * TILE, row * TILE, TILE, TILE).fill({ color: 0x3f3f46 });
            }
          }
        }
        for (let col = 0; col <= COLS; col++) {
          g.moveTo(col * TILE, 0)
            .lineTo(col * TILE, HEIGHT)
            .stroke({ color: 0x27272a, width: 1 });
        }
        for (let row = 0; row <= ROWS; row++) {
          g.moveTo(0, row * TILE)
            .lineTo(WIDTH, row * TILE)
            .stroke({ color: 0x27272a, width: 1 });
        }
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// GameController — click sets the goal; runs findPath and draws the result
// ---------------------------------------------------------------------------
class GameController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly graphics = this.sibling(GraphicsComponent);
  private readonly agent: AgentController;
  private readonly agentEntity: Entity;

  constructor(agentEntity: Entity) {
    super();
    this.agentEntity = agentEntity;
    this.agent = agentEntity.get(AgentController);
  }

  override onAdd(): void {
    this.input.onPointerDown((p) => {
      if (p.button !== 0) return;
      const start = this.agentEntity.get(Transform).position;
      const goal = new Vec2(p.screenPos.x, p.screenPos.y);
      const path = grid.findPath(start, goal);
      this.drawPath(path);
      if (path) this.agent.setPath(path.waypoints);
    });
  }

  private drawPath(path: Path | null): void {
    this.graphics.graphics.clear();
    if (!path) return;
    this.graphics.draw((g) => {
      const [first, ...rest] = path.waypoints;
      if (!first) return;
      g.moveTo(first.x, first.y);
      for (const wp of rest) g.lineTo(wp.x, wp.y);
      g.stroke({ color: 0xfacc15, width: 3 });
      for (const wp of path.waypoints) g.circle(wp.x, wp.y, 3).fill({ color: 0xfacc15 });
    });
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class PathfindingScene extends Scene {
  readonly name = "pathfinding";

  onEnter(): void {
    this.spawn(GridEntity);
    const agent = this.spawn(AgentEntity);

    const controller = this.spawn("controller");
    controller.add(new Transform());
    controller.add(new GraphicsComponent());
    controller.add(new GameController(agent));
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(new InputPlugin());

  await engine.start();
  await engine.scenes.push(new PathfindingScene());
}

main().catch(console.error);
