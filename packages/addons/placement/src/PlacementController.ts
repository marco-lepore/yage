import { Component, defineEvent, ErrorBoundaryKey } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import { PlacementPointerInput } from "./input.js";
import { PlacementSession } from "./core/PlacementSession.js";
import type { PlacementInspection } from "./core/PlacementSession.js";
import type { PlacementEvent, PlacementModel } from "./core/types.js";

export const PlacementCommittedEvent = defineEvent<PlacementEvent["result"]>(
  "placement:committed",
);
export const PlacementRejectedEvent =
  defineEvent<PlacementEvent["result"]>("placement:rejected");

export interface PlacementPreviewChannel {
  mount(host: Entity): void;
  show(session: PlacementSession): void;
  dispose(): void;
}

export interface PlacementCatalogChannel {
  mount(host: Entity): void;
  show(session: PlacementSession): void;
  /** Screen coordinates. Null means the point is outside the catalog. */
  typeAtPoint?(x: number, y: number): string | null;
  dispose(): void;
}

export interface PlacementInputBinding {
  bind(
    host: Entity,
    session: PlacementSession,
    catalog?: Pick<PlacementCatalogChannel, "typeAtPoint">,
  ): void;
  poll(): void;
  dispose(): void;
}

export interface PlacementControllerOptions {
  readonly model: PlacementModel;
  /** Omit for default controls; null disables device input. */
  readonly input?: PlacementInputBinding | null;
  readonly preview?: PlacementPreviewChannel;
  readonly catalog?: PlacementCatalogChannel;
  /** Optional committed-layout presentation, independently replaceable. */
  readonly layout?: PlacementPreviewChannel;
}

/** Entity-owned session. Disabling cancels the draft and releases device input. */
export class PlacementController extends Component {
  static inspectExclude = ["options", "session", "input"];
  private session: PlacementSession | undefined;
  private readonly input: PlacementInputBinding | null;
  constructor(private readonly options: PlacementControllerOptions) {
    super();
    this.input =
      options.input === null
        ? null
        : (options.input ?? new PlacementPointerInput());
  }
  get editor(): PlacementSession {
    if (!this.session || !this.effectiveEnabled || this.entity.isDestroyed)
      throw new Error(
        "PlacementController.editor: requires an enabled live host",
      );
    return this.session;
  }
  get inspection(): PlacementInspection | null {
    return this.session?.inspect() ?? null;
  }

  onAdd(): void {
    const execution = {
      errorBoundary: this.use(ErrorBoundaryKey),
      errorContext: { entity: this.entity.name, scene: this.scene.name },
    };
    this.session = new PlacementSession(this.options.model, execution);
    this.addCleanup(
      this.options.model.subscribe((event) => {
        this.entity.emit(
          event.kind === "committed"
            ? PlacementCommittedEvent
            : PlacementRejectedEvent,
          event.result,
        );
      }, execution),
    );
  }
  onEnable(): void {
    this.call("layout mount", () => this.options.layout?.mount(this.entity));
    this.call("preview mount", () => this.options.preview?.mount(this.entity));
    this.call("catalog mount", () => this.options.catalog?.mount(this.entity));
    const catalog = this.options.catalog;
    this.call("input bind", () =>
      this.input?.bind(
        this.entity,
        this.editor,
        catalog?.typeAtPoint
          ? {
              typeAtPoint: (x, y) =>
                this.call(
                  "catalog hit test",
                  () => catalog.typeAtPoint?.(x, y) ?? null,
                ),
            }
          : undefined,
      ),
    );
  }
  update(): void {
    this.call("input poll", () => this.input?.poll());
    this.editor.refresh();
    this.call("layout show", () => this.options.layout?.show(this.editor));
    this.call("preview show", () => this.options.preview?.show(this.editor));
    this.call("catalog show", () => this.options.catalog?.show(this.editor));
  }
  onDisable(): void {
    this.session?.cancel();
    this.call("input dispose", () => this.input?.dispose());
    this.call("preview dispose", () => this.options.preview?.dispose());
    this.call("catalog dispose", () => this.options.catalog?.dispose());
    this.call("layout dispose", () => this.options.layout?.dispose());
  }
  private call<T>(kind: string, fn: () => T): T {
    let value!: T;
    this.use(ErrorBoundaryKey).wrapCallback(() => (value = fn()), {
      kind: `Placement ${kind}`,
      entity: this.entity.name,
      scene: this.scene.name,
    });
    return value;
  }
}
