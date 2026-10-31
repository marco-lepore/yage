import { ErrorBoundaryKey } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import type { ActionMapInput, InputManager } from "@yagejs/input";
import type {
  PlacementCatalogChannel,
  PlacementInputBinding,
} from "./PlacementController.js";
import type { PlacementSession } from "./core/PlacementSession.js";
import type { PlacementPose } from "./core/types.js";
import { corners, inside, pose } from "./core/geometry.js";

/** Pass to InputPlugin's actions; names are scoped to this addon. */
export function placementControls(): ActionMapInput {
  return {
    "placement-confirm": ["Enter", "GamepadA"],
    "placement-cancel": ["Escape", "GamepadB"],
    "placement-rotate": ["KeyR", "GamepadY"],
    "placement-undo": ["KeyZ", "GamepadLB"],
    "placement-redo": ["KeyY", "GamepadRB"],
    "placement-duplicate": ["KeyD", "GamepadX"],
    "placement-remove": ["Delete", "Backspace"],
    "placement-grid": ["KeyG"],
  };
}

export interface PlacementPointerProjection {
  readonly pose: PlacementPose;
  /** Omit for normal socket snapping; false keeps the aim on its projected plane. */
  readonly snap?: boolean;
}

export interface PlacementPointerInputOptions {
  /** Convert renderer world coordinates to layout coordinates for aiming and default picking. */
  readonly toLayout?: (point: PlacementPose) => PlacementPose;
  /** Pick visible artwork in renderer world coordinates. Null means no hit. */
  readonly hitTest?: (
    point: PlacementPose,
    session: PlacementSession,
  ) => string | null;
  /** Project the pointer onto game-owned supports before the usual grid/socket snapping. */
  readonly project?: (
    pose: PlacementPose,
    session: PlacementSession,
  ) => PlacementPointerProjection;
}

/** Mouse/touch catalog selection and movement, plus the placementControls actions. */
export class PlacementPointerInput implements PlacementInputBinding {
  private input: InputManager | undefined;
  private host: Entity | undefined;
  private session: PlacementSession | undefined;
  private catalog: Pick<PlacementCatalogChannel, "typeAtPoint"> | undefined;
  private selected: string | null = null;
  private angle = 0;
  private lastPoint: { x: number; y: number } | null = null;
  private grid = 16;

  constructor(private readonly options: PlacementPointerInputOptions = {}) {}

  get selectedId(): string | null {
    return this.selected;
  }
  get gridSize(): number {
    return this.grid;
  }

  bind(
    host: Entity,
    session: PlacementSession,
    catalog?: Pick<PlacementCatalogChannel, "typeAtPoint">,
  ): void {
    this.dispose();
    this.host = host;
    this.input = host.scene.use(InputManagerKey);
    this.session = session;
    this.catalog = catalog;
  }
  dispose(): void {
    this.host = undefined;
    this.input = undefined;
    this.session = undefined;
    this.catalog = undefined;
    this.lastPoint = null;
    this.selected = null;
  }

  poll(): void {
    const input = this.input,
      session = this.session;
    if (!input || !session) return;
    if (input.isJustPressed("placement-cancel")) {
      session.cancel();
      this.lastPoint = null;
      return;
    }
    if (input.isJustPressed("placement-undo")) {
      session.undo();
      this.lastPoint = null;
      return;
    }
    if (input.isJustPressed("placement-redo")) {
      session.redo();
      this.lastPoint = null;
      return;
    }
    if (input.isJustPressed("placement-grid")) {
      this.grid = this.grid ? 0 : 16;
      this.lastPoint = null;
    }
    if (input.isJustPressed("placement-rotate")) {
      this.angle += Math.PI / 2;
      session.rotate();
    }
    if (
      this.selected &&
      !session.model.snapshot().objects.some((o) => o.id === this.selected)
    )
      this.selected = null;
    if (this.selected && input.isJustPressed("placement-remove")) {
      session.remove(this.selected);
      this.lastPoint = null;
      return;
    }
    if (this.selected && input.isJustPressed("placement-duplicate")) {
      session.duplicate(this.selected);
      this.angle = session.model.worldPose(this.selected).rotation;
      this.lastPoint = null;
    }
    const mapPoint = (point: { x: number; y: number }): PlacementPose => {
      let mapped: PlacementPose = { ...point, rotation: this.angle };
      if (this.options.toLayout)
        mapped = this.callback("Placement pointer coordinates", () =>
          this.options.toLayout!({ ...mapped }),
        );
      pose(mapped, "pointer.toLayout");
      return mapped;
    };
    const aim = (worldPoint: { x: number; y: number }): void => {
      const point = mapPoint(worldPoint);
      const area = Object.entries(session.model.areas).find(([, value]) =>
        inside([{ ...point, rotation: 0 }], value.bounds),
      )?.[0];
      const command = session.inspect().command;
      // Retain the draft's area outside its bounds, so the preview reports why it fails.
      const targetArea =
        area ??
        (command && "target" in command ? command.target.area : undefined);
      if (targetArea && command) {
        const projected = this.options.project
          ? this.callback("Placement pointer projection", () =>
              this.options.project!(point, session),
            )
          : { pose: point };
        session.aim(projected.pose, targetArea, {
          grid: this.grid,
          snap: projected.snap ?? true,
        });
      }
    };
    const screen = input.getPointerScreenPosition(),
      world = input.getPointerPosition();
    const overCatalog = this.catalog?.typeAtPoint?.(screen.x, screen.y) != null;
    if (
      !overCatalog &&
      (!this.lastPoint ||
        world.x !== this.lastPoint.x ||
        world.y !== this.lastPoint.y)
    ) {
      aim(world);
      this.lastPoint = { ...world };
    }
    for (const press of input.getPointerPresses({ button: 0 })) {
      const type = this.catalog?.typeAtPoint?.(
        press.screenPos.x,
        press.screenPos.y,
      );
      let handled = false;
      if (type) {
        handled = true;
        session.select(type);
        this.angle = 0;
        this.lastPoint = null;
      } else if (session.inspect().command) {
        handled = true;
        if (
          this.lastPoint?.x !== press.worldPos.x ||
          this.lastPoint.y !== press.worldPos.y
        )
          aim(press.worldPos);
        this.lastPoint = { ...press.worldPos };
        session.confirm();
      } else {
        const snapshot = session.model.snapshot();
        const point = mapPoint(press.worldPos);
        const picked = this.options.hitTest
          ? this.callback("Placement pointer hit test", () =>
              this.options.hitTest!(
                { ...press.worldPos, rotation: 0 },
                session,
              ),
            )
          : undefined;
        if (picked != null && !snapshot.objects.some((o) => o.id === picked))
          throw new Error(
            `PlacementPointerInput.hitTest: unknown object ${picked}`,
          );
        const hit =
          picked !== undefined
            ? snapshot.objects.find((o) => o.id === picked)
            : [...snapshot.objects].reverse().find((item) => {
                const at = session.model.worldPose(item.id);
                return session.model.definitions[item.type]!.footprint.some(
                  (rect) => {
                    const polygon = corners(rect, at);
                    // A point in a rotated rectangle, without a renderer dependency.
                    return polygon.every((p, i) => {
                      const q = polygon[(i + 1) % 4]!;
                      return (
                        (q.x - p.x) * (point.y - p.y) -
                          (q.y - p.y) * (point.x - p.x) >=
                        -1e-7
                      );
                    });
                  },
                );
              });
        if (hit) {
          handled = true;
          this.selected = hit.id;
          this.angle = session.model.worldPose(hit.id).rotation;
          session.move(hit.id);
          this.lastPoint = { x: press.worldPos.x, y: press.worldPos.y };
        }
      }
      if (handled) input.consumePointer(press.id);
    }
    if (input.isJustPressed("placement-confirm")) session.confirm();
    if (!session.inspect().command) this.lastPoint = null;
  }

  private callback<T>(kind: string, fn: () => T): T {
    const host = this.host!;
    let result!: T;
    host.scene.use(ErrorBoundaryKey).wrapCallback(
      () => {
        result = fn();
      },
      {
        kind,
        entity: host.name,
        scene: host.scene.name,
      },
    );
    return result;
  }
}
