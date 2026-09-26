import {
  Engine,
  Scene,
  Entity,
  Component,
  Transform,
  Vec2,
} from "@yagejs/core";
import {
  RendererPlugin,
  CameraEntity,
  GraphicsComponent,
  type LayerDef,
} from "@yagejs/renderer";
import { TilemapPlugin, TilemapComponent, tiledMap } from "@yagejs/tilemap";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import { GridGraph, type Path } from "@yagejs/pathfinding";
import { gridFromColliders } from "@yagejs/pathfinding/tilemap";
import { DebugPlugin } from "@yagejs/debug";
import { setupGameContainer } from "../shared/bootstrap.js";

// ---------------------------------------------------------------------------
// Asset handles
// ---------------------------------------------------------------------------
const PathfindingMap = tiledMap("/assets/dungeon/pathfinding-map.json");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WIDTH = 800;
const HEIGHT = 600;
const AGENT_SPEED = 220; // px per second
const AGENT_RADIUS = 6;
const CAMERA_ZOOM = 1.75;

// ---------------------------------------------------------------------------
// AgentController — walks the current path's waypoints in order, with the
// camera following the agent
// ---------------------------------------------------------------------------
class AgentController extends Component {
  private readonly transform = this.sibling(Transform);
  private readonly camera: CameraEntity;
  private path: Vec2[] = [];
  private index = 0;

  constructor(camera: CameraEntity) {
    super();
    this.camera = camera;
  }

  /** Whether the agent still has waypoints to walk. */
  get moving(): boolean {
    return this.index < this.path.length;
  }

  onAdd(): void {
    this.camera.follow(this.transform);
  }

  setPath(waypoints: Vec2[]): void {
    this.path = waypoints;
    this.index = 0;
  }

  update(dt: number): void {
    if (!this.moving) return;
    const target = this.path[this.index]!;
    const next = Vec2.moveTowards(
      this.transform.position,
      target,
      AGENT_SPEED * dt,
    );
    this.transform.setPosition(next.x, next.y);
    if (next.x === target.x && next.y === target.y) this.index++;
  }
}

class AgentEntity extends Entity {
  setup(params: { position: Vec2; camera: CameraEntity }): void {
    this.add(new Transform({ position: params.position }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, AGENT_RADIUS).fill({ color: 0x38bdf8 });
        g.circle(0, 0, AGENT_RADIUS).stroke({ color: 0x0ea5e9, width: 2 });
      }),
    );
    this.add(new AgentController(params.camera));
  }
}

// ---------------------------------------------------------------------------
// TilemapEntity — renders the dungeon map
// ---------------------------------------------------------------------------
class TilemapEntity extends Entity {
  setup(): void {
    this.add(new Transform());
    this.add(new TilemapComponent({ source: PathfindingMap, layer: "map" }));
  }
}

// ---------------------------------------------------------------------------
// GameController — click sets the goal in world space; runs findPath and
// draws the result
// ---------------------------------------------------------------------------
class GameController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly graphics = this.sibling(GraphicsComponent);
  private readonly grid: GridGraph;
  private readonly agent: AgentController;
  private readonly agentEntity: Entity;
  /** The last path found, or `null` when the last click had no route. */
  lastPath: Path | null = null;

  constructor(grid: GridGraph, agentEntity: Entity) {
    super();
    this.grid = grid;
    this.agentEntity = agentEntity;
    this.agent = agentEntity.get(AgentController);
  }

  override onAdd(): void {
    this.addCleanup(
      this.input.onPointerDown((p) => {
        if (p.button !== 0) return;
        const start = this.agentEntity.get(Transform).position;
        // getPointerPosition() runs the click through the camera set via
        // InputManager.setCamera, so the goal lands in world (map) pixels
        // instead of screen pixels.
        const goal = this.input.getPointerPosition();
        const path = this.grid.findPath(start, goal);
        this.lastPath = path;
        this.drawPath(path);
        if (path) this.agent.setPath(path.waypoints);
      }),
    );
  }

  private drawPath(path: Path | null): void {
    this.graphics.draw((g) => {
      g.clear();
      if (!path) return;
      const [first, ...rest] = path.waypoints;
      if (!first) return;
      g.moveTo(first.x, first.y);
      for (const wp of rest) g.lineTo(wp.x, wp.y);
      g.stroke({ color: 0xfacc15, width: 3 });
      for (const wp of path.waypoints)
        g.circle(wp.x, wp.y, 3).fill({ color: 0xfacc15 });
    });
  }
}

// ---------------------------------------------------------------------------
// PathfindingProbe — the last path's length and cost, and whether the agent
// is still walking it. Tests can read it with
// `inspector.getComponentData("PathControllerEntity", "PathfindingProbe")`.
// ---------------------------------------------------------------------------
class PathfindingProbe extends Component {
  private readonly controller = this.sibling(GameController);

  constructor(private readonly agent: AgentController) {
    super();
  }

  /** Cells on the last path found; 0 before the first click or with no route. */
  get pathCells(): number {
    return this.controller.lastPath?.cells.length ?? 0;
  }

  /** Step cost of the last path found, or `null` with no route. */
  get pathCost(): number | null {
    return this.controller.lastPath?.cost ?? null;
  }

  /** Whether the agent is still walking the path. */
  get moving(): boolean {
    return this.agent.moving;
  }
}

/** Turns clicks into paths for the agent and draws the last path found. */
class PathControllerEntity extends Entity {
  setup(params: { grid: GridGraph; agent: AgentEntity }): void {
    const { grid, agent } = params;
    this.add(new Transform());
    this.add(new GraphicsComponent());
    this.add(new GameController(grid, agent));
    this.add(new PathfindingProbe(agent.get(AgentController)));
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class PathfindingScene extends Scene {
  readonly name = "pathfinding";
  readonly preload = [PathfindingMap];
  readonly layers: readonly LayerDef[] = [{ name: "map", order: -10 }];

  onEnter(): void {
    const mapEntity = this.spawn(TilemapEntity);
    const tilemap = mapEntity.get(TilemapComponent);

    const mapW = tilemap.widthPx;
    const mapH = tilemap.heightPx;

    // Real Tiled workflow: object-layer collision shapes -> walkability grid.
    const grid = gridFromColliders(tilemap.data, {
      shapes: tilemap.getCollisionShapes("walls"),
    });

    const cam = this.spawn(CameraEntity, {
      position: new Vec2(mapW / 2, mapH / 2),
      zoom: CAMERA_ZOOM,
      bounds: { minX: 0, minY: 0, maxX: mapW, maxY: mapH },
    });
    this.context.resolve(InputManagerKey).setCamera(cam);

    const playerObj = tilemap.findObjectByName("Player");
    if (!playerObj) {
      throw new Error(
        'Pathfinding example: dungeon map is missing its "Player" spawn point object.',
      );
    }
    const agent = this.spawn(AgentEntity, {
      position: new Vec2(playerObj.x, playerObj.y),
      camera: cam,
    });

    this.spawn(PathControllerEntity, { grid, agent });
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
  engine.use(new TilemapPlugin());
  engine.use(new InputPlugin());
  engine.use(new DebugPlugin());

  await engine.start();

  await engine.scenes.push(new PathfindingScene());
}

main().catch(console.error);
