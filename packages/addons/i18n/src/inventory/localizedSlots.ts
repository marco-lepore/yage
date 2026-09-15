import type { Scene } from "@yagejs/core";
import type {
  DiagnosticSink,
  NavDirection,
  Rect,
  SlotsPresenter,
  SlotView,
} from "@yagejs-addons/inventory";
import { LocalizedPresenterState, type InventoryMessageKeys } from "./keys.js";

/** A slot view with the item's name and description resolved for the locale. */
export function localizeSlotView(
  view: SlotView,
  keys: InventoryMessageKeys,
  state: LocalizedPresenterState,
): SlotView {
  const def = view.def;
  if (!def) return view;
  const description =
    def.description !== undefined && keys.description
      ? state.text(keys.description(def.id), def.description)
      : def.description;
  return {
    ...view,
    def: {
      ...def,
      name: state.text(keys.item(def.id), def.name),
      ...(description !== undefined ? { description } : {}),
    },
  };
}

/**
 * Wraps a slots presenter so every cell sees item names (and descriptions)
 * in the current locale, and re-presents the same slots on a locale change,
 * keeping the selected slot.
 */
class LocalizedSlots implements SlotsPresenter {
  private readonly state = new LocalizedPresenterState();
  private slots: readonly SlotView[] | undefined;
  private selected: number | undefined;

  constructor(
    private readonly inner: SlotsPresenter,
    private readonly keys: InventoryMessageKeys,
  ) {
    if (inner.slotAtPoint) {
      this.slotAtPoint = (x, y) => inner.slotAtPoint!(x, y);
    }
    if (inner.pointerSpace !== undefined)
      this.pointerSpace = inner.pointerSpace;
    if (inner.selectionAnchor) {
      this.selectionAnchor = () => inner.selectionAnchor!();
    }
    if (inner.setDiagnostics) {
      this.setDiagnostics = (warn) => inner.setDiagnostics!(warn);
    }
    if (inner.update) this.update = (dt) => inner.update!(dt);
  }

  readonly slotAtPoint?: (x: number, y: number) => number | undefined;
  readonly pointerSpace?: "screen" | "world";
  readonly selectionAnchor?: () => Rect | undefined;
  readonly setDiagnostics?: (warn: DiagnosticSink) => void;
  readonly update?: (dt: number) => void;

  /** The session assigns this; the inner presenter, which fires it, must
   *  hold the same handler. Write-only: nothing reads it back. */
  set onSlotChosen(handler: (slot: number) => void) {
    this.inner.onSlotChosen = handler;
  }

  mount(scene: Scene): void {
    this.inner.mount(scene);
    this.state.mount(scene, () => {
      if (!this.slots) return;
      this.present(this.slots);
      if (this.selected !== undefined) this.inner.setSelected(this.selected);
    });
  }

  dispose(): void {
    this.state.unmount();
    this.slots = undefined;
    this.inner.dispose();
  }

  present(slots: readonly SlotView[]): void {
    this.slots = slots;
    this.inner.present(
      slots.map((view) => localizeSlotView(view, this.keys, this.state)),
    );
  }

  setSelected(slot: number): void {
    this.selected = slot;
    this.inner.setSelected(slot);
  }

  navigate(from: number, dir: NavDirection): number {
    return this.inner.navigate(from, dir);
  }

  setVisible(visible: boolean): void {
    this.inner.setVisible(visible);
  }

  clear(): void {
    this.slots = undefined;
    this.selected = undefined;
    this.inner.clear();
  }
}

export function localizedSlots(
  slots: SlotsPresenter,
  keys: InventoryMessageKeys,
): SlotsPresenter {
  return new LocalizedSlots(slots, keys);
}
