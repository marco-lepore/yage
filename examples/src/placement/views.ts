import { Entity, Transform } from "@yagejs/core";
import {
  GraphicsComponent,
  SceneRenderTreeKey,
  TextComponent,
} from "@yagejs/renderer";
import type {
  PlacementCatalogChannel,
  PlacementPreviewChannel,
  PlacementSession,
  PlacedObject,
  PlacementPose,
} from "@yagejs-addons/placement";
import { drawFurniture, labels, prices, roomDefinitions } from "./content.js";
import type { FurnitureType, RoomView } from "./content.js";
import { isoArtBounds, isoPoint, isoPaintOrder } from "./isometric.js";
import { supportLabels } from "./copy.js";

function detach(entity: Entity | undefined): void {
  if (!entity || entity.isDestroyed) return;
  const parent = entity.parent;
  entity.destroy();
  if (parent)
    for (const [name, child] of parent.children)
      if (child === entity) {
        parent.removeChild(name);
        break;
      }
}

class CatalogCard extends Entity {
  private background!: GraphicsComponent;
  setup({
    type,
    view,
    index,
  }: {
    type: FurnitureType;
    view: RoomView;
    index: number;
  }): void {
    this.add(new Transform({ position: { x: 16, y: 104 + index * 48 } }));
    this.background = this.add(
      new GraphicsComponent({ layer: "room-catalog" }),
    );
    const box =
      view === "isometric"
        ? isoArtBounds(type)
        : roomDefinitions(view)[type]!.footprint[0]!;
    const scale = Math.min(32 / box.width, 32 / box.height);
    const icon = this.spawnChild("icon");
    icon.add(
      new Transform({
        position: {
          x: 25 - (box.x + box.width / 2) * scale,
          y: 22 - (box.y + box.height / 2) * scale,
        },
        scale: { x: scale, y: scale },
      }),
    );
    icon
      .add(new GraphicsComponent({ layer: "room-catalog" }))
      .draw((g) => drawFurniture(g, type, "oak", view));
    const label = this.spawnChild("label");
    label.add(new Transform({ position: { x: 50, y: 7 } }));
    label.add(
      new TextComponent({
        layer: "room-catalog",
        text: labels[type],
        style: {
          fontFamily: "sans-serif",
          fontSize: 13,
          fontWeight: "bold",
          fill: 0xe8eee8,
        },
      }),
    );
    const detail = this.spawnChild("detail");
    detail.add(new Transform({ position: { x: 50, y: 25 } }));
    detail.add(
      new TextComponent({
        layer: "room-catalog",
        text: `${supportLabels[type]} · ${prices[type]} credits`,
        style: { fontFamily: "sans-serif", fontSize: 10, fill: 0xaabdb7 },
      }),
    );
    this.highlight(false);
  }
  highlight(selected: boolean): void {
    this.background.draw((g) => {
      g.clear()
        .roundRect(0, 0, 188, 44, 6)
        .fill(selected ? 0x33574b : 0x253a35)
        .stroke({
          color: selected ? 0x93d7b5 : 0x3b5149,
          width: selected ? 2 : 1,
        });
    });
  }
}

/** Game artwork and support hints share the controller's catalog channel. */
export class RoomCatalog implements PlacementCatalogChannel {
  private root: Entity | undefined;
  private types: FurnitureType[] = [];
  private shown: string | undefined;
  constructor(private readonly view: RoomView) {}
  mount(host: Entity): void {
    this.dispose();
    host.scene
      .use(SceneRenderTreeKey)
      .ensureLayer({ name: "room-catalog", order: 1060 }, { space: "screen" });
    this.root = host.spawnChild("room-catalog");
  }
  show(session: PlacementSession): void {
    if (!this.root) return;
    if (!this.types.length) {
      this.types = Object.keys(session.model.definitions) as FurnitureType[];
      this.types.forEach((type, index) =>
        this.root!.spawnChild(type, CatalogCard, {
          type,
          view: this.view,
          index,
        }),
      );
    }
    const command = session.inspect().command;
    const selected =
      command?.kind === "place"
        ? command.type
        : command && "id" in command
          ? session.model.snapshot().objects.find((o) => o.id === command.id)
              ?.type
          : undefined;
    if (this.shown === selected) return;
    for (const [type, card] of this.root.children)
      (card as CatalogCard).highlight(type === selected);
    this.shown = selected;
  }
  typeAtPoint(x: number, y: number): string | null {
    return x >= 16 && x < 204 && y >= 104
      ? (this.types[Math.floor((y - 104) / 48)] ?? null)
      : null;
  }
  dispose(): void {
    detach(this.root);
    this.root = undefined;
    this.types = [];
    this.shown = undefined;
  }
}

class PreviewFurniture extends Entity {
  type: FurnitureType = "table";
  private artwork!: GraphicsComponent;
  private outline!: GraphicsComponent;
  setup(): void {
    this.add(new Transform());
    this.artwork = this.add(new GraphicsComponent({ layer: "room-preview" }));
    const frame = this.spawnChild("outline");
    frame.add(new Transform());
    this.outline = frame.add(
      new GraphicsComponent({ layer: "room-preview-outline" }),
    );
  }
  show(
    item: PlacedObject,
    pose: PlacementPose,
    session: PlacementSession,
    view: RoomView,
    valid: boolean,
  ): void {
    this.type = item.type as FurnitureType;
    const preview = session.inspect().preview!;
    const paintOrder =
      view === "isometric" ? isoPaintOrder(preview.after, session.model) : [];
    const paintIndex = paintOrder.findIndex((p) => p.item.id === item.id);
    const presentation = paintOrder[paintIndex];
    const position = presentation?.position ?? pose;
    this.get(Transform).setPosition(position.x, position.y);
    this.get(Transform).setRotation(presentation ? 0 : pose.rotation);
    this.artwork.zIndex = presentation ? paintIndex : 0;
    const finish =
      item.variant === "teal" || item.variant === "rose" ? item.variant : "oak";
    this.artwork.draw((g) =>
      drawFurniture(g, this.type, finish, view, pose.rotation),
    );
    this.artwork.alpha = 0.72;
    this.artwork.tint = valid ? 0xffffff : 0xffb3b3;
    this.outline.draw((g) => {
      g.clear();
      for (const box of session.model.definitions[item.type]!.footprint) {
        if (view === "isometric") {
          const c = Math.cos(pose.rotation),
            s = Math.sin(pose.rotation);
          g.poly(
            [
              [box.x, box.y],
              [box.x + box.width, box.y],
              [box.x + box.width, box.y + box.height],
              [box.x, box.y + box.height],
            ].flatMap(([x, y]) => {
              const p = isoPoint(x! * c - y! * s, x! * s + y! * c);
              return [p.x, p.y];
            }),
          );
        } else g.rect(box.x, box.y, box.width, box.height);
        g.stroke({
          color: valid ? 0x2e9b75 : 0xd94e50,
          width: 2,
        });
      }
      g.circle(0, 0, 3).fill(valid ? 0x2e9b75 : 0xd94e50);
    });
  }
}

/** Preview the same artwork as the final object, including carried children. */
export class RoomPreview implements PlacementPreviewChannel {
  private root: Entity | undefined;
  constructor(private readonly view: RoomView) {}
  get types(): readonly string[] {
    return this.root
      ? [...this.root.children.values()].map(
          (e) => (e as PreviewFurniture).type,
        )
      : [];
  }
  mount(host: Entity): void {
    this.dispose();
    const tree = host.scene.use(SceneRenderTreeKey);
    tree.ensureLayer({ name: "room-preview", order: 50 });
    tree.ensureLayer({ name: "room-preview-outline", order: 51 });
    this.root = host.spawnChild("room-preview");
  }
  show(session: PlacementSession): void {
    if (!this.root) return;
    const preview = session.inspect().preview;
    const changed =
      preview && !preview.issues.some((i) => i.code === "attachment")
        ? preview.changes.flatMap((c) => (c.after ? [c.after.id] : []))
        : [];
    for (const [id, child] of this.root.children)
      if (!changed.includes(id)) detach(child);
    if (!preview) return;
    for (const id of new Set(changed)) {
      const item = preview.after.objects.find((o) => o.id === id)!;
      const ghost = this.root.children.get(id) as PreviewFurniture | undefined;
      (ghost ?? this.root.spawnChild(id, PreviewFurniture)).show(
        item,
        session.model.worldPose(id, preview.after),
        session,
        this.view,
        preview.ok,
      );
    }
  }
  dispose(): void {
    detach(this.root);
    this.root = undefined;
  }
}
