import { Component, Entity, ErrorBoundaryKey, Transform } from "@yagejs/core";
import type { Serializable } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import { instantiateLevel, prepareLevel } from "@yagejs/level";
import {
  createSave,
  localStorageAdapter,
  SlotNotFoundError,
} from "@yagejs/save";
import {
  GraphicsComponent,
  SceneRenderTreeKey,
  TextComponent,
} from "@yagejs/renderer";
import { PlacementController, PlacementLayout } from "@yagejs-addons/placement";
import type {
  PlacementEvaluation,
  PlacementResult,
  PlacementSnapshot,
  PlacementPose,
  PlacementSession,
  PlacementIssue,
} from "@yagejs-addons/placement";
import { PlacementPointerInput } from "@yagejs-addons/placement";
import {
  at,
  catalog,
  roomDefinitions,
  FurnitureLook,
  labels,
  prices,
} from "./content.js";
import type { FurnitureType, RoomView } from "./content.js";
import { RoomCatalog, RoomPreview } from "./views.js";
import {
  drawIsoRoom,
  isoBounds,
  isoFloor,
  isoPaintOrder,
  pickIsoFurniture,
  projectIsoSupport,
} from "./isometric.js";
import { placementHints, roomInstructions, roomTitles } from "./copy.js";

function cost(e: PlacementEvaluation): number {
  return e.changes.reduce(
    (sum, change) =>
      sum +
      (change.operation === "place"
        ? (prices[change.after!.type as FurnitureType] ?? 0)
        : change.operation === "remove"
          ? -(prices[change.before!.type as FurnitureType] ?? 0)
          : 0),
    0,
  );
}
interface RoomSave {
  readonly layout: PlacementSnapshot;
  readonly credits: number;
}

/** The game owns its layout, money, permissions, input focus and save slot. */
export class RoomEditor extends Component {
  static inspectExclude = [
    "layout",
    "controller",
    "binding",
    "save",
    "root",
    "background",
    "status",
    "shown",
    "previewView",
    "meta",
  ];
  private layout!: PlacementLayout;
  private controller!: PlacementController;
  private readonly binding: PlacementPointerInput;
  private readonly previewView: RoomPreview;
  private readonly save = createSave({
    adapter: localStorageAdapter({ namespace: "yage-placement-views" }),
  });
  private root!: Serializable<RoomSave>;
  private background!: GraphicsComponent;
  private status!: TextComponent;
  private meta!: TextComponent;
  private shown: PlacementSnapshot | null = null;
  credits = 50;
  locked = false;
  message: string;
  saved = false;
  saving = false;
  constructor(readonly view: RoomView) {
    super();
    this.message = roomInstructions[view];
    this.previewView = new RoomPreview(view);
    this.binding = new PlacementPointerInput(
      view === "side"
        ? {
            project: (pose, session) => ({
              pose: this.projectSidePointer(pose, session),
            }),
          }
        : view === "isometric"
          ? {
              toLayout: isoFloor,
              hitTest: pickIsoFurniture,
              project: projectIsoSupport,
            }
          : {},
    );
  }
  get previewTypes(): readonly string[] {
    return this.previewView.types;
  }
  get layoutState(): PlacementSnapshot {
    return this.layout.snapshot();
  }
  get poses(): Readonly<
    Record<string, { x: number; y: number; rotation: number }>
  > {
    return Object.fromEntries(
      this.layout
        .snapshot()
        .objects.map((o) => [o.id, this.layout.worldPose(o.id)]),
    );
  }
  get preview(): PlacementResult | null {
    return this.controller.inspection?.preview ?? null;
  }

  onAdd(): void {
    const tree = this.use(SceneRenderTreeKey);
    tree.ensureLayer({ name: "room", order: -20 });
    tree.ensureLayer({ name: "floor-modules", order: -10 });
    tree.ensureLayer({ name: "walls", order: -5 });
    tree.ensureLayer({ name: "furniture", order: 0 });
    tree.ensureLayer({ name: "room-hud", order: 1061 }, { space: "screen" });
    const backdrop = this.entity.spawnChild("room-background");
    backdrop.add(new Transform());
    this.background = backdrop.add(new GraphicsComponent({ layer: "room" }));
    const hud = this.entity.spawnChild("room-status");
    hud.add(new Transform({ position: { x: 24, y: 478 } }));
    this.status = hud.add(
      new TextComponent({
        layer: "room-hud",
        text: "",
        style: {
          fontFamily: "sans-serif",
          fontSize: 15,
          fill: 0xe8eee8,
          lineHeight: 24,
        },
      }),
    );
    const meta = this.entity.spawnChild("room-meta");
    meta.add(new Transform({ position: { x: 24, y: 546 } }));
    this.meta = meta.add(
      new TextComponent({
        layer: "room-hud",
        text: "",
        style: {
          fontFamily: "sans-serif",
          fontSize: 12,
          fill: 0xaabdb7,
          lineHeight: 22,
        },
      }),
    );
    for (const [name, x, y, text, size] of [
      ["title", 20, 20, roomTitles[this.view], 22],
      [
        "perspective",
        490,
        25,
        this.view === "topdown"
          ? "TOP-DOWN  /  LOOKING STRAIGHT DOWN"
          : this.view === "side"
            ? "SIDE VIEW  /  LOOKING INTO THE ROOM"
            : "ISOMETRIC  /  FOLLOW THE FLOOR GRID",
        12,
      ],
      ["choose", 16, 64, "1  CHOOSE AN OBJECT", 12],
      ["place", 248, 64, "2  MOVE THE PREVIEW     3  CLICK TO PLACE", 12],
    ] as const) {
      const label = this.entity.spawnChild(name);
      label.add(new Transform({ position: { x, y } }));
      label.add(
        new TextComponent({
          layer: "room-hud",
          text,
          style: {
            fontFamily: "sans-serif",
            fontSize: size,
            fontWeight: "bold",
            fill: 0xdce9df,
          },
        }),
      );
    }
    if (this.view !== "side") {
      const tip = this.entity.spawnChild("room-tip");
      tip.add(new Transform({ position: { x: 20, y: 328 } }));
      tip.add(
        new TextComponent({
          layer: "room-hud",
          text: "TRY THIS\nMove the table.\nIts lamp moves too.\n\nLamps belong on tables.\nChairs go on the floor.",
          style: {
            fontFamily: "sans-serif",
            fontSize: 12,
            lineHeight: 20,
            fill: 0xaabdb7,
          },
        }),
      );
    }
    this.layout = new PlacementLayout({
      catalog,
      definitions: roomDefinitions(this.view),
      areas: {
        studio: {
          bounds:
            this.view === "isometric"
              ? isoBounds
              : { x: 232, y: 96, width: 608, height: 352 },
          finishes: { floor: ["oak", "tile"], walls: ["sage", "sand"] },
        },
      },
      errorBoundary: this.use(ErrorBoundaryKey),
      errorContext: { entity: this.entity.name, scene: this.scene.name },
      rules: [
        { id: "side-view-support", evaluate: (e) => this.checkSupports(e) },
        {
          id: "room-owner",
          evaluate: () =>
            this.locked
              ? [
                  {
                    code: "room-locked",
                    message: "Unlock the room with P before editing.",
                  },
                ]
              : [],
        },
        {
          id: "materials",
          evaluate: (e) =>
            cost(e) > this.credits
              ? [
                  {
                    code: "materials",
                    message: `Requires ${cost(e)} credits; ${this.credits} available.`,
                  },
                ]
              : [],
        },
      ],
    });
    this.addCleanup(
      this.layout.subscribe((event) => {
        if (event.kind === "rejected") {
          this.message = event.result.issues.map((i) => i.message).join(" ");
          return;
        }
        if (event.result.intent !== "restore")
          this.credits -= cost(event.result);
        this.message =
          event.result.intent === "restore"
            ? "Saved layout restored, including attachments and finishes."
            : {
                place: "Object placed.",
                move: "Object and attachments moved.",
                duplicate: "Object and attachments copied.",
                remove: "Object removed.",
                modify: "Furniture finish updated.",
                customize: "Room finish updated.",
                undo: "Edit undone.",
                redo: "Edit repeated.",
                batch: roomInstructions[this.view],
              }[event.result.intent];
      }),
    );
    this.seed();
    this.controller = this.entity.add(
      new PlacementController({
        model: this.layout,
        input: this.binding,
        preview: this.previewView,
        catalog: new RoomCatalog(this.view),
      }),
    );
    this.root = {
      serialize: () => ({
        layout: this.layout.snapshot(),
        credits: this.credits,
      }),
      hydrate: (raw) => {
        if (!Number.isSafeInteger(raw.credits) || raw.credits < 0)
          throw new Error(`RoomEditor.hydrate: invalid credits ${raw.credits}`);
        const result = this.layout.restore(raw.layout);
        if (!result.ok)
          throw new Error(result.issues.map((i) => i.message).join("\n"));
        this.credits = raw.credits;
      },
    };
    this.syncVisuals();
  }

  update(): void {
    const input = this.use(InputManagerKey);
    if (input.isJustPressed("room-lock")) {
      this.locked = !this.locked;
      this.message = this.locked
        ? "Room locked. Press P to unlock editing."
        : "Room unlocked.";
    }
    if (input.isJustPressed("room-floor"))
      this.layout.commit({
        kind: "customize",
        area: "studio",
        finishes: {
          floor:
            this.layout.snapshot().finishes.studio?.floor === "oak"
              ? "tile"
              : "oak",
        },
      });
    if (input.isJustPressed("room-walls"))
      this.layout.commit({
        kind: "customize",
        area: "studio",
        finishes: {
          walls:
            this.layout.snapshot().finishes.studio?.walls === "sage"
              ? "sand"
              : "sage",
        },
      });
    if (input.isJustPressed("room-finish") && this.binding.selectedId) {
      const item = this.layout
        .snapshot()
        .objects.find((o) => o.id === this.binding.selectedId);
      if (item && this.layout.definitions[item.type]?.variants)
        this.layout.commit({
          kind: "modify",
          id: item.id,
          variant: item.variant === "teal" ? "rose" : "teal",
        });
    }
    if (input.isJustPressed("room-cascade") && this.binding.selectedId)
      this.controller.editor.remove(this.binding.selectedId, true);
    if (!this.saving && input.isJustPressed("room-save")) this.io("save");
    if (!this.saving && input.isJustPressed("room-load")) this.io("load");
    this.syncVisuals();
    const inspection = this.controller.inspection;
    const command = inspection?.command;
    const draft = inspection?.preview;
    const type =
      command?.kind === "place"
        ? command.type
        : command && "id" in command
          ? this.layout.snapshot().objects.find((o) => o.id === command.id)
              ?.type
          : undefined;
    const changed = new Set(
      draft?.changes.flatMap((c) => (c.before ? [c.before.id] : [])) ?? [],
    );
    for (const item of this.layout.snapshot().objects) {
      const entity = this.scene.findByKey(`room/${item.id}`);
      if (entity)
        entity.get(GraphicsComponent).alpha = changed.has(item.id) ? 0.25 : 1;
    }
    if (type && command && "target" in command) {
      const target = command.target;
      const parent = this.layout
        .snapshot()
        .objects.find((o) => o.id === target.attachment?.parent);
      const support = parent
        ? labels[parent.type as FurnitureType].toLowerCase()
        : "room floor";
      const verb =
        command.kind === "move"
          ? "Moving"
          : command.kind === "duplicate"
            ? "Copying"
            : "Placing";
      const issue = draft?.issues[0];
      const reason = issue
        ? this.placementReason(type as FurnitureType, issue)
        : "Click to place. Press Esc to cancel.";
      this.status.setText(
        `${verb} ${labels[type as FurnitureType].toLowerCase()} · ${draft?.ok ? `on the ${support}` : "choose a valid spot"}\n${reason}`,
      );
      this.status.mergeStyle({ fill: draft?.ok ? 0xb2e4c6 : 0xffb9ab });
    } else {
      this.status.setText(
        `${this.message}\nClick an object to move it. Attached objects move together.`,
      );
      this.status.mergeStyle({ fill: 0xe8eee8 });
    }
    this.meta.setText(
      `${this.credits} credits   ·   ${this.binding.gridSize ? "16 px grid" : "Free placement"}   ·   ${this.locked ? "Room locked" : "Room editable"}\n${this.view !== "side" ? "R rotate · " : ""}G grid / free · Esc cancel · Z / Y undo / redo · More controls below`,
    );
  }

  private placementReason(type: FurnitureType, issue: PlacementIssue): string {
    if (issue.code === "surface" || issue.code === "socket-type")
      return type === "wall"
        ? "Use a floor section without a wall panel."
        : placementHints[type];
    if (issue.code === "occupied")
      return "This space is occupied. Move the preview to a clear spot.";
    if (issue.code === "socket-bounds")
      return "Move the whole object onto its support.";
    if (issue.code === "outside-area")
      return "Keep the whole object inside the room.";
    return issue.message;
  }

  /** In a side view, the pointer chooses a support; furniture rests on its top. */
  private projectSidePointer(
    pointer: PlacementPose,
    session: PlacementSession,
  ): PlacementPose {
    const command = session.inspect().command;
    if (!command || !("target" in command)) return pointer;
    const snapshot = session.model.snapshot();
    const current =
      "id" in command
        ? snapshot.objects.find((o) => o.id === command.id)
        : undefined;
    const type = command.kind === "place" ? command.type : current?.type;
    if (!type || type === "art") return pointer;
    if (type === "floor") return { ...pointer, y: 416, rotation: 0 };
    const excluded = new Set<string>();
    if (current && command.kind === "move") {
      excluded.add(current.id);
      for (let i = 0; i < snapshot.objects.length; i++)
        for (const item of snapshot.objects)
          if (item.attachment && excluded.has(item.attachment.parent))
            excluded.add(item.id);
    }
    let best: PlacementPose | undefined =
      type === "lamp" || type === "wall"
        ? undefined
        : { ...pointer, y: 432, rotation: 0 };
    let distance = best ? Math.abs(pointer.y - best.y) : Infinity;
    for (const parent of snapshot.objects) {
      if (excluded.has(parent.id)) continue;
      const world = session.model.worldPose(parent.id);
      for (const socket of Object.values(
        session.model.definitions[parent.type]!.sockets ?? {},
      )) {
        if (!socket.accepts?.includes(type)) continue;
        const x = world.x + socket.pose.x,
          y = world.y + socket.pose.y;
        const halfWidth = socket.bounds ? socket.bounds.width / 2 : 80;
        if (Math.abs(pointer.x - x) > halfWidth) continue;
        const onFloorSection =
          parent.type === "floor" && pointer.y >= y && pointer.y <= y + 16;
        const near = onFloorSection ? 0 : Math.abs(pointer.y - y);
        if (near <= distance) {
          distance = near;
          best = { x: socket.bounds ? pointer.x : x, y, rotation: 0 };
        }
      }
    }
    return best ?? { ...pointer, rotation: 0 };
  }

  private checkSupports(
    evaluation: PlacementEvaluation,
  ): readonly PlacementIssue[] {
    if (this.view !== "side") return [];
    for (const item of evaluation.after.objects) {
      if (item.pose.rotation !== 0)
        return [
          {
            code: "upright",
            message: "Side-view objects stay upright.",
            object: item.id,
          },
        ];
      if (item.type === "art") continue;
      const y = item.attachment ? 0 : item.type === "floor" ? 416 : 432;
      if (item.pose.y !== y)
        return [
          {
            code: "support",
            message: "Furniture must rest on the floor or a table.",
            object: item.id,
          },
        ];
    }
    return [];
  }

  private seed(): void {
    const commands =
      this.view !== "side"
        ? ([
            {
              kind: "place",
              type: "table",
              target: this.view === "isometric" ? at(128, 112) : at(352, 192),
            },
            {
              kind: "place",
              type: "lamp",
              target: {
                ...at(0, 0),
                attachment: { parent: "p1", socket: "top" },
              },
            },
            {
              kind: "place",
              type: "chair",
              target: this.view === "isometric" ? at(128, 208) : at(352, 288),
            },
            {
              kind: "place",
              type: "plant",
              target: this.view === "isometric" ? at(240, 80) : at(480, 160),
            },
          ] as const)
        : ([
            { kind: "place", type: "floor", target: at(576, 416) },
            {
              kind: "place",
              type: "wall",
              target: {
                ...at(0, 0),
                attachment: { parent: "p1", socket: "back" },
              },
            },
            {
              kind: "place",
              type: "table",
              target: {
                ...at(0, 0),
                attachment: { parent: "p1", socket: "top" },
              },
            },
            {
              kind: "place",
              type: "lamp",
              target: {
                ...at(0, 0),
                attachment: { parent: "p3", socket: "top" },
              },
            },
            {
              kind: "place",
              type: "art",
              target: {
                ...at(-36, 0),
                attachment: { parent: "p2", socket: "art" },
              },
            },
            { kind: "place", type: "chair", target: at(320, 432) },
            { kind: "place", type: "plant", target: at(432, 432) },
          ] as const);
    const result = this.layout.commit({ kind: "batch", commands });
    if (!result.ok)
      throw new Error(result.issues.map((i) => i.message).join("\n"));
  }

  private io(operation: "save" | "load"): void {
    this.saving = true;
    this.controller.editor.cancel();
    this.use(ErrorBoundaryKey).wrapCallback(
      async () => {
        try {
          if (operation === "save")
            await this.save.saveSlot(
              `room-${this.view}`,
              "workshop",
              this.root,
            );
          else
            await this.save.loadSlot(
              `room-${this.view}`,
              "workshop",
              this.root,
            );
          if (!this.entity.isDestroyed) {
            this.saved = true;
            this.message =
              operation === "save"
                ? "Layout saved to this browser."
                : "Layout loaded from this browser.";
          }
        } catch (error) {
          if (error instanceof SlotNotFoundError)
            this.message = "Save a layout with S first.";
          else throw error;
        } finally {
          this.saving = false;
        }
      },
      { kind: "Room save", entity: this.entity.name, scene: this.scene.name },
    );
  }

  private syncVisuals(): void {
    const snapshot = this.layout.snapshot();
    if (snapshot === this.shown) return;
    for (const old of this.shown?.objects ?? [])
      if (!snapshot.objects.some((o) => o.id === old.id && o.type === old.type))
        this.entity.removeChild(old.id).destroy();
    const document = this.layout.toLevelDocument();
    const paintOrder =
      this.view === "isometric" ? isoPaintOrder(snapshot, this.layout) : [];
    for (const item of snapshot.objects) {
      let entity = this.scene.findByKey(`room/${item.id}`);
      const world = this.layout.worldPose(item.id);
      if (!entity) {
        const placement = document.entities.find((e) => e.id === item.id)!;
        const independent = { ...placement };
        delete independent.parent;
        // These furniture schemas have no entity references. Each visual can be
        // instantiated independently and follow its layout's world pose.
        const prepared = prepareLevel(
          {
            ...document,
            entities: [
              {
                ...independent,
                transform: {
                  ...independent.transform,
                  position: world,
                  rotation: world.rotation,
                },
              },
            ],
          },
          catalog,
        );
        const instance = instantiateLevel(this.scene, prepared, {
          namespace: "room",
        });
        entity = instance.get(item.id)!;
        this.entity.addChild(item.id, entity);
      }
      const paintIndex = paintOrder.findIndex((p) => p.item.id === item.id);
      const presentation = paintOrder[paintIndex];
      const position = presentation?.position ?? world;
      entity.get(Transform).setPosition(position.x, position.y);
      entity.get(Transform).setRotation(presentation ? 0 : world.rotation);
      entity.get(GraphicsComponent).zIndex = presentation ? paintIndex : 0;
      const finish =
        item.variant === "teal" || item.variant === "rose"
          ? item.variant
          : "oak";
      entity.get(FurnitureLook).setFinish(finish, world.rotation);
    }
    this.background.draw((g) => {
      const floor =
        snapshot.finishes.studio?.floor === "oak" ? 0xe5d4b7 : 0xc9dcd4;
      const wall =
        snapshot.finishes.studio?.walls === "sage" ? 0x9bb09c : 0xbfae93;
      if (this.view === "isometric") {
        drawIsoRoom(g, floor, wall);
        return;
      }
      g.clear().roundRect(224, 88, 624, 368, 6).fill(wall);
      g.rect(232, 96, 608, 352).fill(
        this.view === "topdown" ? floor : 0xf0eadc,
      );
      if (this.view === "topdown") {
        for (let y = 112; y < 448; y += 32)
          g.moveTo(232, y)
            .lineTo(840, y)
            .stroke({ color: 0x86745e, alpha: 0.16, width: 1 });
        for (let x = 248; x < 840; x += 96)
          for (let y = 112; y < 448; y += 64)
            g.moveTo(x, y)
              .lineTo(x, Math.min(y + 32, 448))
              .stroke({ color: 0x86745e, alpha: 0.16, width: 1 });
        g.rect(472, 88, 128, 8)
          .fill(0xddebf0)
          .stroke({ color: 0x718b8b, width: 1 });
        g.rect(500, 448, 80, 8).fill(floor);
      } else {
        g.rect(232, 432, 608, 16).fill(floor);
        g.moveTo(232, 432)
          .lineTo(840, 432)
          .stroke({ color: 0x7f7564, width: 2 });
        g.rect(692, 128, 112, 96)
          .fill(0xabc5c8)
          .stroke({ color: 0xb7a88b, width: 6 });
        g.moveTo(748, 128)
          .lineTo(748, 224)
          .moveTo(692, 176)
          .lineTo(804, 176)
          .stroke({ color: 0xe2dbca, width: 4 });
        g.rect(684, 224, 128, 6).fill(0xb7a88b);
      }
    });
    this.shown = snapshot;
  }
}

export class RoomEditorEntity extends Entity {
  setup(view: RoomView): void {
    this.add(new Transform());
    this.add(new RoomEditor(view));
  }
}
