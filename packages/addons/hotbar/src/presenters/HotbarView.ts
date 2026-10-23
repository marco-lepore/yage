import { Transform } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import {
  GraphicsComponent,
  RendererKey,
  SceneRenderTreeKey,
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

interface Cell {
  readonly label: TextComponent;
  icon: SpriteComponent | undefined;
  iconKey: string | undefined;
  color: number;
}

/**
 * One row of clickable slots on a screen layer. The view spawns its own
 * entities into the scene, so the controller's entity can move freely. Use a
 * separate instance for each controller.
 */
export class HotbarView implements HotbarPresenter {
  readonly theme: HotbarTheme;
  private scene: Scene | undefined;
  private frame: GraphicsComponent | undefined;
  private cells: Cell[] = [];
  private visible = false;
  private x = 0;
  private y = 0;
  private state: HotbarState | undefined;

  /** Fields left out keep their `defaultHotbarTheme()` values. */
  constructor(theme: Partial<HotbarTheme> = {}) {
    const resolved = { ...defaultHotbarTheme(), ...theme };
    this.theme = { ...resolved, keyLabels: [...resolved.keyLabels] };
    for (const field of ["slotWidth", "slotHeight", "fontSize"] as const) {
      if (!Number.isFinite(resolved[field]) || resolved[field] <= 0)
        throw new Error(
          `HotbarView.constructor: ${field} must be finite and positive, got ${resolved[field]}`,
        );
    }
    if (!Number.isFinite(resolved.gap) || resolved.gap < 0)
      throw new Error(
        `HotbarView.constructor: gap must be finite and nonnegative, got ${resolved.gap}`,
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
        !Number.isInteger(resolved[field]) ||
        resolved[field] < 0 ||
        resolved[field] > 0xffffff
      )
        throw new Error(
          `HotbarView.constructor: ${field} must be a 24-bit color, got ${resolved[field]}`,
        );
    }
    for (const field of ["x", "y"] as const)
      if (resolved[field] !== undefined && !Number.isFinite(resolved[field]))
        throw new Error(
          `HotbarView.constructor: ${field} must be finite, got ${resolved[field]}`,
        );
  }

  mount(scene: Scene): void {
    if (this.scene) throw new Error("HotbarView.mount: view already mounted");
    scene
      .tryResolveScoped(SceneRenderTreeKey)
      ?.ensureLayer({ name: this.theme.layer, order: 1070, space: "screen" });
    this.scene = scene;
    const frame = scene.spawn("hotbar-frame");
    frame.add(new Transform());
    this.frame = frame.add(new GraphicsComponent({ layer: this.theme.layer }));
    this.frame.visible = this.visible;
  }

  present(state: HotbarState): void {
    const scene = this.scene;
    if (!scene) throw new Error("HotbarView.present: mount the view first");
    const t = this.theme;
    const viewport = scene.context.resolve(RendererKey).virtualSize;
    const width =
      state.slots.length * t.slotWidth + (state.slots.length - 1) * t.gap;
    this.x = t.x ?? (viewport.width - width) / 2;
    this.y = t.y ?? viewport.height - t.slotHeight - 24;
    this.state = state;
    for (const cell of this.cells.splice(state.slots.length)) destroyCell(cell);
    for (const slot of state.slots) {
      const cell = (this.cells[slot.index] ??= this.createCell(scene));
      const x = this.x + slot.index * (t.slotWidth + t.gap);
      if (cell.iconKey !== slot.icon) this.setIcon(scene, cell, slot.icon);
      if (cell.icon) {
        cell.icon.entity
          .get(Transform)
          .setPosition(x + t.slotWidth / 2, this.y + 16);
        cell.icon.visible = this.visible && cell.iconKey !== undefined;
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
        .setPosition(x + 6, this.y + (cell.iconKey !== undefined ? 32 : 10));
      cell.label.visible = this.visible;
    }
    this.frame?.draw((g) => {
      g.clear();
      for (const slot of state.slots) {
        const x = this.x + slot.index * (t.slotWidth + t.gap);
        g.roundRect(x, this.y, t.slotWidth, t.slotHeight, 6)
          .fill(t.background)
          .stroke({
            color: slot.index === state.selected ? t.selected : t.border,
            width: 2,
          });
        if (slot.cooldown && slot.cooldown.remaining > 0)
          g.rect(
            x + 4,
            this.y + t.slotHeight - 8,
            Math.max(0, t.slotWidth - 8) * (1 - slot.cooldown.ratio),
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
    if (this.frame) this.frame.visible = visible;
    for (const cell of this.cells) {
      cell.label.visible = visible;
      if (cell.icon) cell.icon.visible = visible && cell.iconKey !== undefined;
    }
  }
  dispose(): void {
    this.frame?.entity.destroy();
    for (const cell of this.cells) destroyCell(cell);
    this.scene = undefined;
    this.frame = undefined;
    this.cells = [];
    this.state = undefined;
    this.visible = false;
  }

  private createCell(scene: Scene): Cell {
    const t = this.theme;
    const entity = scene.spawn("hotbar-label");
    entity.add(new Transform());
    const label = entity.add(
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
    );
    return { label, icon: undefined, iconKey: undefined, color: t.text };
  }

  private setIcon(scene: Scene, cell: Cell, key: string | undefined): void {
    if (key === undefined) {
      cell.iconKey = undefined;
      return;
    }
    // Resolve before recording the key: an unregistered key throws on every
    // frame until it is registered.
    const texture = resolveTextureInput(key);
    cell.iconKey = key;
    if (cell.icon) cell.icon.setTexture(key);
    else {
      const entity = scene.spawn("hotbar-icon");
      entity.add(new Transform());
      cell.icon = entity.add(
        new SpriteComponent({
          texture: key,
          layer: this.theme.layer,
          anchor: { x: 0.5, y: 0.5 },
        }),
      );
    }
    const scale = Math.min(24 / texture.width, 24 / texture.height);
    cell.icon.entity.get(Transform).setScale(scale, scale);
  }
}

function destroyCell(cell: Cell): void {
  cell.label.entity.destroy();
  cell.icon?.entity.destroy();
}
