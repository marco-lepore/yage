import { Transform } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import {
  GraphicsComponent,
  RendererKey,
  SceneRenderTreeProviderKey,
  SpriteComponent,
  TextComponent,
  resolveTextureInput,
} from "@yagejs/renderer";
import type { HotbarPresenter } from "../adapter.js";
import type { HotbarState } from "../core/types.js";

export interface HotbarTheme {
  /** Omit to center horizontally in the renderer's virtual viewport. */
  readonly x?: number;
  /** Omit to place 24 pixels above the viewport bottom. */
  readonly y?: number;
  readonly slotWidth: number;
  readonly slotHeight: number;
  readonly gap: number;
  readonly background: number;
  readonly border: number;
  readonly selected: number;
  readonly cooldown: number;
  readonly text: number;
  readonly unavailable: number;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly layer: string;
  /** Slot hints in index order; omit a hint with an empty string. */
  readonly keyLabels: readonly string[];
}

export function defaultHotbarTheme(): HotbarTheme {
  return {
    slotWidth: 80,
    slotHeight: 100,
    gap: 8,
    background: 0x18263a,
    border: 0x334b68,
    selected: 0x66e3c4,
    cooldown: 0x569ee8,
    text: 0xf0f5ff,
    unavailable: 0x94a3b8,
    fontFamily: "sans-serif",
    fontSize: 13,
    layer: "hotbar",
    keyLabels: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  };
}

/** One row of clickable slots. Use a separate instance for each controller. */
export class HotbarView implements HotbarPresenter {
  private root: Entity | undefined;
  private graphics: GraphicsComponent | undefined;
  private cells: {
    label: TextComponent;
    icon: SpriteComponent | undefined;
    iconKey: string | undefined;
    color: number;
  }[] = [];
  private visible = false;
  private x = 0;
  private y = 0;
  private state: HotbarState | undefined;
  readonly theme: HotbarTheme;

  constructor(theme: HotbarTheme = defaultHotbarTheme()) {
    this.theme = { ...theme, keyLabels: [...theme.keyLabels] };
    for (const field of ["slotWidth", "slotHeight", "fontSize"] as const) {
      if (!Number.isFinite(theme[field]) || theme[field] <= 0)
        throw new Error(
          `HotbarView.constructor: ${field} must be finite and positive, got ${theme[field]}`,
        );
    }
    if (!Number.isFinite(theme.gap) || theme.gap < 0)
      throw new Error(
        `HotbarView.constructor: gap must be finite and nonnegative, got ${theme.gap}`,
      );
    for (const field of [
      "background",
      "border",
      "selected",
      "cooldown",
      "text",
      "unavailable",
    ] as const) {
      if (
        !Number.isInteger(theme[field]) ||
        theme[field] < 0 ||
        theme[field] > 0xffffff
      )
        throw new Error(
          `HotbarView.constructor: ${field} must be a 24-bit color, got ${theme[field]}`,
        );
    }
    for (const field of ["x", "y"] as const)
      if (theme[field] !== undefined && !Number.isFinite(theme[field]))
        throw new Error(
          `HotbarView.constructor: ${field} must be finite, got ${theme[field]}`,
        );
  }

  mount(owner: Entity): void {
    if (this.root) throw new Error("HotbarView.mount: view already mounted");
    owner.scene.context
      .tryResolve(SceneRenderTreeProviderKey)
      ?.getTree(owner.scene)
      ?.ensureLayer({ name: this.theme.layer, order: 1070, space: "screen" });
    this.root = owner.spawnChild("hotbar-view");
    this.root.add(new Transform());
    this.graphics = this.root.add(
      new GraphicsComponent({ layer: this.theme.layer }),
    );
    this.graphics.visible = this.visible;
  }

  present(state: HotbarState): void {
    const root = this.root;
    if (!root) throw new Error("HotbarView.present: mount the view first");
    const t = this.theme;
    const viewport = root.scene.context.resolve(RendererKey).virtualSize;
    const width =
      state.slots.length * t.slotWidth + (state.slots.length - 1) * t.gap;
    this.x = t.x ?? (viewport.width - width) / 2;
    this.y = t.y ?? viewport.height - t.slotHeight - 24;
    this.state = state;
    while (this.cells.length > state.slots.length) {
      const cell = this.cells.pop()!;
      destroyChild(cell.label.entity);
      if (cell.icon) destroyChild(cell.icon.entity);
    }
    for (const slot of state.slots) {
      let cell = this.cells[slot.index];
      if (!cell) {
        const label = root.spawnChild(`hotbar-label-${slot.index}`);
        label.add(new Transform());
        cell = {
          label: label.add(
            new TextComponent({
              text: "",
              layer: t.layer,
              style: {
                fontFamily: t.fontFamily,
                fontSize: t.fontSize,
                fill: t.text,
                wordWrap: true,
                wordWrapWidth: Math.max(1, t.slotWidth - 12),
              },
            }),
          ),
          icon: undefined,
          iconKey: undefined,
          color: t.text,
        };
        this.cells.push(cell);
      }
      const x = this.x + slot.index * (t.slotWidth + t.gap);
      if (cell.iconKey !== slot.icon) {
        const texture = slot.icon ? resolveTextureInput(slot.icon) : undefined;
        if (cell.icon) destroyChild(cell.icon.entity);
        cell.icon = undefined;
        cell.iconKey = slot.icon;
        if (texture && slot.icon) {
          const icon = root.spawnChild(`hotbar-icon-${slot.index}`);
          icon.add(new Transform());
          cell.icon = icon.add(
            new SpriteComponent({
              texture: slot.icon,
              layer: t.layer,
              anchor: { x: 0.5, y: 0.5 },
            }),
          );
          const scale = Math.min(24 / texture.width, 24 / texture.height);
          icon.get(Transform).setScale(scale, scale);
        }
      }
      if (cell.icon) {
        cell.icon.entity
          .get(Transform)
          .setPosition(x + t.slotWidth / 2, this.y + 16);
        cell.icon.visible = this.visible;
      }
      const key = t.keyLabels[slot.index];
      const hint = key ? `${key} · ` : "";
      const count = slot.count === null ? "" : ` ×${slot.count}`;
      const status =
        slot.cooldown && slot.cooldown.remaining > 0
          ? `${slot.cooldown.remaining.toFixed(1)}s`
          : (slot.reason ?? "Ready");
      cell.label.setText(`${hint}${slot.label}${count}\n${status}`);
      const color = slot.available ? t.text : t.unavailable;
      if (cell.color !== color) {
        cell.label.mergeStyle({ fill: color });
        cell.color = color;
      }
      cell.label.entity
        .get(Transform)
        .setPosition(x + 6, this.y + (cell.icon ? 32 : 10));
      cell.label.visible = this.visible;
    }
    this.graphics?.draw((g) => {
      g.clear();
      for (const slot of state.slots) {
        const x = this.x + slot.index * (t.slotWidth + t.gap);
        g.roundRect(x, this.y, t.slotWidth, t.slotHeight, 6)
          .fill(t.background)
          .stroke({
            color: slot.index === state.selected ? t.selected : t.border,
            width: 2,
          });
        if (slot.cooldown && slot.cooldown.total > 0)
          g.rect(
            x + 4,
            this.y + t.slotHeight - 8,
            (Math.max(0, t.slotWidth - 8) * slot.cooldown.remaining) /
              slot.cooldown.total,
            4,
          ).fill(t.cooldown);
      }
    });
  }

  slotAtPoint(x: number, y: number): number | undefined {
    if (
      !this.visible ||
      !this.state ||
      y < this.y ||
      y >= this.y + this.theme.slotHeight
    )
      return undefined;
    const local = x - this.x;
    const stride = this.theme.slotWidth + this.theme.gap;
    const index = Math.floor(local / stride);
    return index >= 0 &&
      index < this.state.slots.length &&
      local - index * stride < this.theme.slotWidth
      ? index
      : undefined;
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.graphics) this.graphics.visible = visible;
    for (const cell of this.cells) {
      cell.label.visible = visible;
      if (cell.icon) cell.icon.visible = visible;
    }
  }
  dispose(): void {
    if (this.root) destroyChild(this.root);
    this.root = undefined;
    this.graphics = undefined;
    this.cells = [];
    this.state = undefined;
    this.visible = false;
  }
}

function destroyChild(entity: Entity): void {
  const parent = entity.parent;
  entity.destroy();
  // Destruction is deferred; release the child name before another mount or icon change.
  if (parent) parent.removeChild(entity.name);
}
