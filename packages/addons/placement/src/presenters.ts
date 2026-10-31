import { Entity, Transform } from "@yagejs/core";
import {
  GraphicsComponent,
  SceneRenderTreeKey,
  TextComponent,
} from "@yagejs/renderer";
import type {
  PlacementCatalogChannel,
  PlacementPreviewChannel,
} from "./PlacementController.js";
import type { PlacementSession } from "./core/PlacementSession.js";
import { corners, finite } from "./core/geometry.js";
import type { PlacementSnapshot } from "./core/types.js";

/** A minimal committed-layout view for prototypes; game entities can replace it. */
export class PlacementLayoutView implements PlacementPreviewChannel {
  private entity: Entity | undefined;
  private graphics: GraphicsComponent | undefined;
  private shown: PlacementSnapshot | undefined;

  mount(host: Entity): void {
    this.dispose();
    host.scene
      .use(SceneRenderTreeKey)
      .ensureLayer({ name: "placement-layout", order: 0 });
    this.entity = host.spawnChild("placement-layout");
    const drawing = this.entity.spawnChild("drawing");
    drawing.add(new Transform());
    this.graphics = drawing.add(
      new GraphicsComponent({ layer: "placement-layout" }),
    );
  }
  show(session: PlacementSession): void {
    const snapshot = session.model.snapshot();
    if (snapshot === this.shown) return;
    this.graphics?.draw((g) => {
      g.clear();
      for (const area of Object.values(session.model.areas))
        g.rect(
          area.bounds.x,
          area.bounds.y,
          area.bounds.width,
          area.bounds.height,
        )
          .fill({ color: 0x243345, alpha: 0.8 })
          .stroke({ color: 0x61778a, width: 1 });
      for (const item of snapshot.objects)
        for (const box of session.model.definitions[item.type]!.footprint)
          g.poly(corners(box, session.model.worldPose(item.id)))
            .fill({ color: item.attachment ? 0xb8dec8 : 0xd1b58a, alpha: 0.85 })
            .stroke({ color: 0x202a35, width: 1 });
    });
    this.shown = snapshot;
  }
  dispose(): void {
    detach(this.entity);
    this.entity = undefined;
    this.graphics = undefined;
    this.shown = undefined;
  }
}

function detach(entity: Entity | undefined): void {
  if (!entity || entity.isDestroyed) return;
  // Child names can be reused immediately after a disable/enable in one frame.
  const parent = entity.parent;
  entity.destroy();
  if (parent)
    for (const [name, child] of parent.children)
      if (child === entity) {
        parent.removeChild(name);
        break;
      }
}

/** Footprint outlines for every changed object, including attached descendants. */
export class PlacementPreviewView implements PlacementPreviewChannel {
  private entity: Entity | undefined;
  private graphics: GraphicsComponent | undefined;
  mount(host: Entity): void {
    this.dispose();
    host.scene
      .use(SceneRenderTreeKey)
      .ensureLayer({ name: "placement-preview", order: 50 });
    this.entity = host.spawnChild("placement-preview");
    const drawing = this.entity.spawnChild("drawing");
    drawing.add(new Transform());
    this.graphics = drawing.add(
      new GraphicsComponent({ layer: "placement-preview" }),
    );
  }
  show(session: PlacementSession): void {
    const preview = session.inspect().preview;
    this.graphics?.draw((g) => {
      g.clear();
      if (!preview || preview.issues.some((i) => i.code === "attachment"))
        return;
      const changed = new Set(
        preview.changes.flatMap((c) => (c.after ? [c.after.id] : [])),
      );
      for (const item of preview.after.objects) {
        if (!changed.has(item.id)) continue;
        const at = session.model.worldPose(item.id, preview.after);
        for (const box of session.model.definitions[item.type]!.footprint) {
          g.poly(corners(box, at))
            .fill({ color: preview.ok ? 0x59d7b2 : 0xff6578, alpha: 0.28 })
            .stroke({ color: preview.ok ? 0x9af5d3 : 0xff8492, width: 2 });
        }
      }
    });
  }
  dispose(): void {
    detach(this.entity);
    this.entity = undefined;
    this.graphics = undefined;
  }
}

export interface PlacementCatalogViewOptions {
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly rowHeight?: number;
}

class CatalogRow extends Entity {
  setup(options: {
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
  }): void {
    this.add(new Transform({ position: { x: options.x, y: options.y } }));
    this.add(new GraphicsComponent({ layer: "placement-catalog" })).draw((g) =>
      g.roundRect(0, 0, options.width, options.height - 4, 7).fill(0x233044),
    );
    const label = this.spawnChild("label");
    label.add(new Transform({ position: { x: 12, y: 10 } }));
    label.add(
      new TextComponent({
        layer: "placement-catalog",
        text: options.label,
        style: { fontFamily: "sans-serif", fontSize: 15, fill: 0xe5ecf7 },
      }),
    );
  }
}

/** Canvas catalog. Its screen-space hit test is independent from preview drawing. */
export class PlacementCatalogView implements PlacementCatalogChannel {
  private root: Entity | undefined;
  private types: string[] = [];
  private readonly x: number;
  private readonly y: number;
  private readonly width: number;
  private readonly rowHeight: number;
  constructor(options: PlacementCatalogViewOptions = {}) {
    this.x = options.x ?? 16;
    this.y = options.y ?? 72;
    this.width = options.width ?? 176;
    this.rowHeight = options.rowHeight ?? 44;
    for (const [key, value] of Object.entries({
      x: this.x,
      y: this.y,
      width: this.width,
      rowHeight: this.rowHeight,
    }))
      finite(value, `catalog.${key}`);
    if (this.width <= 0 || this.rowHeight <= 0)
      throw new Error(
        "PlacementCatalogView: width and rowHeight must be positive",
      );
  }
  mount(host: Entity): void {
    this.dispose();
    host.scene
      .use(SceneRenderTreeKey)
      .ensureLayer(
        { name: "placement-catalog", order: 1060 },
        { space: "screen" },
      );
    this.root = host.spawnChild("placement-catalog");
  }
  show(session: PlacementSession): void {
    if (!this.root || this.types.length) return;
    this.types = Object.keys(session.model.definitions);
    for (const [i, type] of this.types.entries())
      this.root.spawnChild(`row-${i}`, CatalogRow, {
        x: this.x,
        y: this.y + i * this.rowHeight,
        width: this.width,
        height: this.rowHeight,
        label: session.model.definitions[type]!.label ?? type,
      });
  }
  typeAtPoint(x: number, y: number): string | null {
    if (x < this.x || x >= this.x + this.width || y < this.y) return null;
    return this.types[Math.floor((y - this.y) / this.rowHeight)] ?? null;
  }
  dispose(): void {
    detach(this.root);
    this.root = undefined;
    this.types = [];
  }
}

/** Working canvas defaults, with each channel individually replaceable. */
export function createPlacementViews(
  options: PlacementCatalogViewOptions = {},
): {
  layout: PlacementLayoutView;
  preview: PlacementPreviewView;
  catalog: PlacementCatalogView;
} {
  return {
    layout: new PlacementLayoutView(),
    preview: new PlacementPreviewView(),
    catalog: new PlacementCatalogView(options),
  };
}
