import { compose, finite, pose, relative } from "./geometry.js";
import type {
  PlacementCommand,
  PlacementExecution,
  PlacementModel,
  PlacementPose,
  PlacementResult,
  PlacementSnapshot,
  PlacementTarget,
} from "./types.js";

export interface PlacementAimOptions {
  /** World-grid spacing in pixels; 0 means free placement. Default 16. */
  readonly grid?: number;
  /** Try compatible sockets before the grid. Default true. */
  readonly snap?: boolean;
}

export interface PlacementInspection {
  readonly revision: number;
  readonly command: PlacementCommand | null;
  readonly preview: PlacementResult | null;
  readonly lastResult: PlacementResult | null;
  readonly snapshot: PlacementSnapshot;
}

/** An input-independent editing cursor. Cancel discards only its pending command. */
export class PlacementSession {
  private command: PlacementCommand | null = null;
  private previewResult: PlacementResult | null = null;
  private result: PlacementResult | null = null;

  constructor(
    readonly model: PlacementModel,
    private readonly execution: PlacementExecution = {},
  ) {}

  select(type: string, target?: PlacementTarget): void {
    if (!Object.hasOwn(this.model.definitions, type))
      throw new Error(`PlacementSession.select: unknown type ${type}`);
    const area = Object.keys(this.model.areas)[0];
    if (!area)
      throw new Error("PlacementSession.select: at least one area is required");
    const bounds = this.model.areas[area]!.bounds;
    this.setCommand({
      kind: "place",
      type,
      target: target ?? {
        area,
        pose: {
          x: bounds.x + bounds.width / 2,
          y: bounds.y + bounds.height / 2,
          rotation: 0,
        },
      },
    });
  }

  move(id: string): void {
    this.startExisting("move", id);
  }
  duplicate(id: string): void {
    this.startExisting("duplicate", id);
  }

  /** Explicit commands support headless tools and custom editors. */
  setCommand(command: PlacementCommand): void {
    const result = this.model.preview(command, this.execution);
    this.command = structuredClone(command);
    this.previewResult = result;
  }

  aim(
    world: PlacementPose,
    area: string,
    options: PlacementAimOptions = {},
  ): void {
    pose(world, "aim");
    const grid = options.grid ?? 16;
    finite(grid, "aim.grid");
    if (grid < 0)
      throw new Error(
        `Placement.aim.grid: expected nonnegative spacing, got ${grid}`,
      );
    const command = this.command;
    if (!command || !("target" in command)) return;
    const snapshot = this.model.snapshot();
    const item =
      "id" in command
        ? snapshot.objects.find((o) => o.id === command.id)
        : undefined;
    const type = command.kind === "place" ? command.type : item?.type;
    if (!type) return;
    const excluded = new Set<string>();
    if (item && command.kind === "move") {
      excluded.add(item.id);
      for (let i = 0; i < snapshot.objects.length; i++)
        for (const o of snapshot.objects)
          if (o.attachment && excluded.has(o.attachment.parent))
            excluded.add(o.id);
    }
    let best:
      | { target: PlacementTarget; priority: number; distance: number }
      | undefined;
    if (options.snap !== false)
      for (const parent of snapshot.objects) {
        if (parent.area !== area || excluded.has(parent.id)) continue;
        for (const [socketId, socket] of Object.entries(
          this.model.definitions[parent.type]!.sockets ?? {},
        )) {
          if (socket.accepts && !socket.accepts.includes(type)) continue;
          if (
            !(this.model.definitions[type]!.surfaces ?? ["floor"]).includes(
              socket.surface,
            )
          )
            continue;
          const occupied = snapshot.objects.filter(
            (o) =>
              !excluded.has(o.id) &&
              o.attachment?.parent === parent.id &&
              o.attachment.socket === socketId,
          ).length;
          if (occupied >= (socket.capacity ?? 1)) continue;
          const origin = compose(this.model.worldPose(parent.id), socket.pose);
          const local = relative(origin, world);
          const distance = socket.bounds
            ? Math.hypot(
                Math.max(
                  socket.bounds.x - local.x,
                  0,
                  local.x - socket.bounds.x - socket.bounds.width,
                ),
                Math.max(
                  socket.bounds.y - local.y,
                  0,
                  local.y - socket.bounds.y - socket.bounds.height,
                ),
              )
            : Math.hypot(local.x, local.y);
          if (distance > (socket.radius ?? 24)) continue;
          const target: PlacementTarget = {
            area,
            attachment: { parent: parent.id, socket: socketId },
            pose: socket.bounds
              ? local
              : { x: 0, y: 0, rotation: local.rotation },
          };
          const priority = socket.priority ?? 0;
          if (
            !best ||
            priority > best.priority ||
            (priority === best.priority && distance < best.distance)
          )
            best = { target, priority, distance };
        }
      }
    const target = best?.target ?? {
      area,
      pose: {
        x: grid ? Math.round(world.x / grid) * grid : world.x,
        y: grid ? Math.round(world.y / grid) * grid : world.y,
        rotation: world.rotation,
      },
    };
    this.setCommand({ ...command, target });
  }

  rotate(radians = Math.PI / 2): void {
    finite(radians, "rotate");
    const command = this.command;
    if (command && "target" in command)
      this.setCommand({
        ...command,
        target: {
          ...command.target,
          pose: {
            ...command.target.pose,
            rotation: command.target.pose.rotation + radians,
          },
        },
      });
  }

  confirm(): PlacementResult | null {
    if (!this.command) return null;
    const result = this.model.commit(this.command, this.execution);
    this.result = result;
    if (result.ok) this.cancel();
    else this.previewResult = result;
    return result;
  }

  cancel(): void {
    this.command = null;
    this.previewResult = null;
  }
  remove(id: string, cascade = false): PlacementResult {
    this.cancel();
    return (this.result = this.model.commit(
      { kind: "remove", id, cascade },
      this.execution,
    ));
  }
  undo(): PlacementResult {
    this.cancel();
    return (this.result = this.model.undo(this.execution));
  }
  redo(): PlacementResult {
    this.cancel();
    return (this.result = this.model.redo(this.execution));
  }
  refresh(): void {
    if (this.command)
      this.previewResult = this.model.preview(this.command, this.execution);
  }

  inspect(): PlacementInspection {
    return {
      revision: this.model.revision,
      command: this.command ? structuredClone(this.command) : null,
      preview: this.previewResult,
      lastResult: this.result,
      snapshot: this.model.snapshot(),
    };
  }

  private startExisting(kind: "move" | "duplicate", id: string): void {
    const item = this.model.snapshot().objects.find((o) => o.id === id);
    if (!item)
      throw new Error(`PlacementSession.${kind}: unknown object ${id}`);
    this.setCommand({
      kind,
      id,
      target: {
        area: item.area,
        pose: item.pose,
        ...(item.attachment ? { attachment: item.attachment } : {}),
      },
    });
  }
}
