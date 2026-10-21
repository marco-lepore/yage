import {
  Component,
  Engine,
  Entity,
  RandomKey,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import {
  CameraEntity,
  GraphicsComponent,
  RendererPlugin,
  TextComponent,
} from "@yagejs/renderer";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import {
  isRoomLayoutWalkable,
  GenerationController,
  GenerationFinishedEvent,
  RoomGenerator,
  CaveGenerator,
} from "@yagejs-addons/procedural";
import type {
  RoomLayout,
  RoomDefinition,
  TileMap,
} from "@yagejs-addons/procedural";
import type { GridGraph } from "@yagejs/pathfinding";
import { createRoomLayoutGraph } from "@yagejs-addons/procedural/navigation";
import { instantiateRoomLayout } from "@yagejs-addons/procedural/level";
import type { LevelInstance } from "@yagejs/level";
import { setupGameContainer } from "../shared/bootstrap.js";
import { createRooms } from "./rooms.js";
import type { Vec2Like } from "@yagejs/core";
import { ROOM_CENTER, ROOM_SCALE, TILE_SIZE } from "./constants.js";
import { prepareRoomContent } from "./content.js";

const WIDTH = 960,
  HEIGHT = 680;

class RoomLab extends Component {
  static override readonly inspectExclude = [
    "camera",
    "board",
    "cursor",
    "hud",
    "input",
    "instances",
    "content",
    "generator",
    "definition",
    "cave",
    "navigation",
  ];
  private readonly input = this.service(InputManagerKey);
  private readonly content = prepareRoomContent();
  private instances: readonly LevelInstance[] = [];
  private generator: RoomGenerator | CaveGenerator | undefined;
  private definition: RoomDefinition | undefined;
  private cave: TileMap | null = null;
  private navigation: GridGraph | undefined;
  private keys: string[] = [];
  private layout: RoomLayout | null = null;
  private position: Vec2Like = { ...ROOM_CENTER };
  private selected = 0;
  private seed = 0;
  private mode = "normal";
  private visited: string[] = [];
  private path: readonly Vec2Like[] = [];
  constructor(
    private readonly camera: CameraEntity,
    private readonly board: GraphicsComponent,
    private readonly cursor: GraphicsComponent,
    private readonly hud: TextComponent,
  ) {
    super();
  }
  get exploration(): {
    seed: number;
    mode: string;
    selectedRoom: string | null;
    currentRoom: string | null;
    visited: readonly string[];
    pathLength: number;
    position: Vec2Like;
    keys: readonly string[];
    roomCount: number;
    caveSize: { width: number; height: number } | null;
  } {
    return {
      seed: this.seed,
      mode: this.mode,
      selectedRoom: this.layout?.rooms[this.selected]?.id ?? null,
      currentRoom: this.currentRoom(),
      visited: this.visited,
      pathLength: this.path.length,
      position: this.position,
      keys: this.keys,
      roomCount: this.layout?.rooms.length ?? 0,
      caveSize: this.cave
        ? { width: this.cave.cells[0]!.length, height: this.cave.cells.length }
        : null,
    };
  }
  onAdd(): void {
    this.seed = this.use(RandomKey).int(0, 999_999);
    this.listen(this.entity, GenerationFinishedEvent, () => this.showResult());
    this.addCleanup(() => {
      for (const instance of this.instances) instance.dispose();
    });
    this.regenerate("normal");
  }
  private regenerate(mode: string): void {
    this.mode = mode;
    this.entity.remove(GenerationController);
    for (const instance of this.instances) instance.dispose();
    this.instances = [];
    this.layout = null;
    this.cave = null;
    this.navigation = undefined;
    this.keys = [];
    this.visited = [];
    this.path = [];
    this.selected = 0;
    this.board.draw((g) => {
      g.clear();
    });
    this.cursor.draw((g) => {
      g.clear();
    });
    this.definition = mode === "cave" ? undefined : createRooms(this.seed);
    if (mode === "unsatisfiable")
      this.definition = { ...this.definition!, maxUses: { entry: 0 } };
    this.generator =
      mode === "cave"
        ? new CaveGenerator({
            seed: this.seed,
            width: 72,
            height: 42,
            maxSteps: 100_000,
          })
        : new RoomGenerator(this.definition!, {
            seed: this.seed,
            maxSteps: mode === "budget" ? 1 : 200_000,
          });
    this.entity.add(new GenerationController(this.generator, 1000));
    this.hud.setText(`Seed ${this.seed} | ${mode}\nSearching…`);
  }
  private showResult(): void {
    const generator = this.generator!;
    if (generator instanceof CaveGenerator) {
      this.cave = generator.result;
      if (this.cave) {
        const map = this.cave;
        this.board.draw((g) => {
          g.clear();
          map.cells.forEach((row, y) =>
            [...row].forEach((cell, x) =>
              g
                .rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE)
                .fill(cell === "." ? 0x3c6762 : 0x141e2e),
            ),
          );
        });
        this.camera.zoom = Math.min(
          (WIDTH - 80) / (72 * TILE_SIZE),
          (HEIGHT - 220) / (42 * TILE_SIZE),
        );
        this.camera.position = new Vec2(
          36 * TILE_SIZE,
          21 * TILE_SIZE - 60 / this.camera.zoom,
        );
        this.hud.setText(
          `CAVE   Seed ${this.seed}   ${generator.steps} steps\n72 × 42 tiles · one connected floor area · no room catalog\nC returns to rooms · R changes seed`,
        );
        return;
      }
    } else this.layout = generator.result;
    if (!this.layout) {
      this.hud.setText(
        `Seed ${this.seed} | ${generator.status}\n${generator
          .inspect()
          .diagnostics.map((d) => d.message)
          .join("\n")}\nPress R for a new layout.`,
      );
      return;
    }
    const layout = this.layout;
    this.instances = instantiateRoomLayout(
      this.scene,
      this.definition!,
      layout,
      this.content,
      `rooms-${this.seed}`,
      ROOM_SCALE,
    );
    const left = Math.min(...layout.rooms.map((room) => room.x * TILE_SIZE)),
      top = Math.min(...layout.rooms.map((room) => room.y * TILE_SIZE));
    const right = Math.max(
        ...layout.rooms.map((room) => (room.x + room.width) * TILE_SIZE),
      ),
      bottom = Math.max(
        ...layout.rooms.map((room) => (room.y + room.height) * TILE_SIZE),
      );
    this.camera.zoom = Math.min(
      (WIDTH - 80) / (right - left),
      (HEIGHT - 220) / (bottom - top),
    );
    this.camera.position = new Vec2(
      (left + right) / 2,
      (top + bottom) / 2 - 60 / this.camera.zoom,
    );
    this.drawRooms();
    const root = layout.rooms[0]!;
    this.position = {
      x: root.x * TILE_SIZE + ROOM_CENTER.x,
      y: root.y * TILE_SIZE + ROOM_CENTER.y,
    };
    this.refresh();
  }
  private drawRooms(): void {
    const layout = this.layout!;
    this.board.draw((g) => {
      g.clear();
      for (const room of layout.rooms) {
        const color =
          typeof room.metadata.color === "number"
            ? room.metadata.color
            : room.id === "start"
              ? 0x1e6659
              : room.id === "boss"
                ? 0x786128
                : ["shop", "forge", "treasure"].includes(
                      this.definition!.graph.regions.find(
                        (r) => r.id === room.id,
                      )!.kind,
                    )
                  ? 0x554176
                  : 0x314a67;
        for (let y = room.y; y < room.y + room.height; y++)
          for (let x = room.x; x < room.x + room.width; x++) {
            g.rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE).fill(
              isRoomLayoutWalkable(
                this.definition!,
                layout,
                { x, y },
                this.keys,
              )
                ? color
                : 0x141e2e,
            );
          }
        g.rect(
          room.x * TILE_SIZE,
          room.y * TILE_SIZE,
          room.width * TILE_SIZE,
          room.height * TILE_SIZE,
        ).stroke({
          color: 0x6b8099,
          width: 1,
        });
      }
    });
  }
  private currentRoom(): string | null {
    return (
      this.layout?.rooms.find(
        (room) =>
          this.position.x >= room.x * TILE_SIZE &&
          this.position.y >= room.y * TILE_SIZE &&
          this.position.x < (room.x + room.width) * TILE_SIZE &&
          this.position.y < (room.y + room.height) * TILE_SIZE,
      )?.id ?? null
    );
  }
  private refresh(): void {
    if (!this.layout) return;
    const selected = this.layout.rooms[this.selected]!;
    const current = this.currentRoom();
    if (current && !this.visited.includes(current)) this.visited.push(current);
    let acquired = false;
    for (const key of this.definition!.graph.regions.find(
      (region) => region.id === current,
    )?.grants ?? [])
      if (!this.keys.includes(key)) {
        this.keys.push(key);
        acquired = true;
      }
    if (acquired) this.drawRooms();
    if (!this.navigation || acquired)
      this.navigation = createRoomLayoutGraph(
        this.definition!,
        this.layout,
        ROOM_SCALE,
        { keys: this.keys },
      );
    this.path =
      this.navigation.findPath(this.position, {
        x: selected.x * TILE_SIZE + ROOM_CENTER.x,
        y: selected.y * TILE_SIZE + ROOM_CENTER.y,
      })?.waypoints ?? [];
    this.cursor.draw((g) => {
      g.clear();
      g.rect(
        selected.x * TILE_SIZE,
        selected.y * TILE_SIZE,
        selected.width * TILE_SIZE,
        selected.height * TILE_SIZE,
      ).stroke({
        color: 0xfbbf24,
        width: 2,
      });
      for (const point of this.path)
        g.circle(point.x, point.y, 1.5).fill(0xfbbf24);
      g.circle(this.position.x, this.position.y, 4).fill(0xf8fafc);
    });
    this.hud.setText(
      `CATALOG DUNGEON   Seed ${this.seed}   ${this.generator!.steps} search steps\n${this.layout.rooms.length} rooms · shop and forge never connect · boss needs both treasure keys\nSelected: ${selected.id} (${selected.templateId}) · Current: ${current}\nVariant: ${selected.variantId ?? "base"}${typeof selected.metadata.stock === "string" ? ` · Stock: ${selected.metadata.stock}` : ""}\nKeys: ${this.keys.join(", ") || "none"} · ${this.path.length ? "Route available" : "Selected room locked"}\nTAB selects · SPACE follows · Arrows move · R new seed · C caves · B budget · U impossible`,
    );
  }
  update(): void {
    if (this.input.isJustPressed("cave")) {
      this.regenerate(this.mode === "cave" ? "normal" : "cave");
      return;
    }
    if (this.input.isJustPressed("regenerate")) {
      this.seed = (this.seed + 1) >>> 0;
      this.regenerate(this.mode === "cave" ? "cave" : "normal");
      return;
    }
    if (this.input.isJustPressed("budget")) {
      this.regenerate("budget");
      return;
    }
    if (this.input.isJustPressed("unsatisfiable")) {
      this.regenerate("unsatisfiable");
      return;
    }
    if (!this.layout) return;
    if (this.input.isJustPressed("select")) {
      this.selected = (this.selected + 1) % this.layout.rooms.length;
      this.refresh();
    }
    if (this.input.isJustPressed("follow", { repeat: true }) && this.path[1]) {
      this.position = this.path[1];
      this.refresh();
    }
    for (const [action, dx, dy] of [
      ["left", -TILE_SIZE, 0],
      ["right", TILE_SIZE, 0],
      ["up", 0, -TILE_SIZE],
      ["down", 0, TILE_SIZE],
    ] as const)
      if (this.input.isJustPressed(action, { repeat: true })) {
        const next = { x: this.position.x + dx, y: this.position.y + dy };
        if (
          isRoomLayoutWalkable(
            this.definition!,
            this.layout,
            {
              x: Math.floor(next.x / TILE_SIZE),
              y: Math.floor(next.y / TILE_SIZE),
            },
            this.keys,
          )
        ) {
          this.position = next;
          this.refresh();
        }
      }
  }
}
class LabEntity extends Entity {
  setup(params: { camera: CameraEntity }): void {
    this.add(new Transform());
    const board = this.add(new GraphicsComponent({ layer: "rooms" }));
    const cursorEntity = this.spawnChild("cursor");
    cursorEntity.add(new Transform());
    const cursor = cursorEntity.add(new GraphicsComponent({ layer: "cursor" }));
    const label = this.spawnChild("status");
    label.add(new Transform({ position: new Vec2(24, 18) }));
    const hud = label.add(
      new TextComponent({
        layer: "hud",
        text: "",
        style: {
          fontFamily: "monospace",
          fontSize: 13,
          fill: 0xdce8f5,
          lineHeight: 23,
          wordWrap: true,
          wordWrapWidth: WIDTH - 48,
        },
      }),
    );
    this.add(new RoomLab(params.camera, board, cursor, hud));
  }
}
class RoomLabScene extends Scene {
  readonly name = "procedural-rooms";
  readonly layers = [
    { name: "rooms", order: 0 },
    { name: "content", order: 1 },
    { name: "cursor", order: 2 },
    { name: "hud", order: 1000, space: "screen" },
  ] as const;

  onEnter(): void {
    const camera = this.spawn(CameraEntity);
    this.spawn(LabEntity, { camera }, { key: "room-lab" });
  }
}
async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0b1220,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(
    new InputPlugin({
      actions: {
        left: ["ArrowLeft", "KeyA"],
        right: ["ArrowRight", "KeyD"],
        up: ["ArrowUp", "KeyW"],
        down: ["ArrowDown", "KeyS"],
        select: ["Tab"],
        follow: ["Space"],
        regenerate: ["KeyR"],
        cave: ["KeyC"],
        budget: ["KeyB"],
        unsatisfiable: ["KeyU"],
      },
    }),
  );
  engine.use(new DebugPlugin({ startEnabled: false }));
  await engine.start();
  await engine.scenes.push(new RoomLabScene());
}
void main();
