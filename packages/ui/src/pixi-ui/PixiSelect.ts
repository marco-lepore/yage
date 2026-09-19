import type { FancyButton } from "@pixi/ui";
import { Select } from "@pixi/ui";
import { Container } from "pixi.js";
import type {
  FocusDirection,
  PixiSelectProps,
  UIFocusOutlineBox,
} from "../types.js";
import type { UIInputCaptureElement } from "../focus/input-capture.js";
import { captureFocusInput } from "../focus/input-capture.js";
import { PixiUIBase } from "./PixiUIBase.js";
import { resolvePixiView } from "./view-resolver.js";

// The dropdown is reparented directly under the stage (above the fit-scaled
// world root that holds every scene layer), so any positive zIndex wins; the
// large value plus `sortableChildren` is belt-and-suspenders if the stage ever
// sorts its children.
const DROPDOWN_Z = 2_000_000;

/** Walk to the top of the display tree (the renderer's stage). */
function topAncestor(node: Container): Container {
  let n: Container = node;
  while (n.parent) n = n.parent;
  return n;
}

/**
 * `@pixi/ui` `Select` renders its dropdown list inline — a child of the Select
 * at the Select's own z-position — and open/close is just `view.visible`. So a
 * sibling drawn later (a label under the Select, a panel below it) paints over
 * the open list and intercepts its pointer events.
 *
 * This subclass lifts the dropdown container (`view`, which holds the open
 * background, close button, and the scrollable list) to the top of the render
 * tree while open, so it draws above all other UI like a web dropdown. The
 * reparent preserves the dropdown's on-screen position and scale via the world
 * transform, so it stays put and correctly sized regardless of the fit scale
 * between the UI layer and the stage.
 */
class PortalSelect extends Select {
  /** Notified after every open/close with the resulting open state. */
  onOpenChange: ((open: boolean) => void) | undefined;
  private _portalHost: Container | null = null;
  /** The dropdown's child index in the Select, captured before portaling. */
  private _originalIndex = 0;
  /** The row a confirm press commits, or `-1` while no row is lit. */
  private _highlight = -1;

  // `Select.toggle()` sets `view.visible` directly and doesn't delegate to
  // `open`/`close`, so all three are hooked to catch every path. If a future
  // `toggle()` ever delegated, `onOpenChange` would fire twice — harmless,
  // since `portalDropdown`/`restoreDropdown` are idempotent.
  override toggle(): void {
    super.toggle();
    this.onOpenChange?.(this.view.visible);
  }
  override open(): void {
    super.open();
    this.onOpenChange?.(true);
  }
  override close(): void {
    super.close();
    this.onOpenChange?.(false);
  }

  /** Reparent the dropdown to the top of the render tree, keeping its
   *  on-screen position and scale. Idempotent. */
  portalDropdown(): void {
    if (this._portalHost) return;
    const host = topAncestor(this);
    if (host === this || host === this.view.parent) return;
    // Local transform under `host` that reproduces the dropdown's current world
    // transform (it sits at the Select's origin, local (0,0), so its world
    // transform equals the Select's).
    const local = host.worldTransform
      .clone()
      .invert()
      .append(this.worldTransform);
    // Appended last, `view` already draws on top of the stage's other children;
    // the high zIndex only matters if something else put the stage in sorted
    // mode. Don't force `sortableChildren` — that would leave the stage sorting
    // on every tick for the app's lifetime.
    this._originalIndex = this.getChildIndex(this.view);
    this.view.zIndex = DROPDOWN_Z;
    host.addChild(this.view);
    this.view.setFromMatrix(local);
    this._portalHost = host;
  }

  /** Put the dropdown back inside the Select at its original slot. Idempotent. */
  restoreDropdown(): void {
    if (!this._portalHost) return;
    this._portalHost = null;
    // Scene torn down while open: the dropdown was destroyed with the stage.
    if (this.view.destroyed || this.destroyed) return;
    this.view.zIndex = 0;
    this.view.position.set(0, 0);
    this.view.scale.set(1, 1);
    this.view.rotation = 0;
    this.addChildAt(this.view, this._originalIndex);
  }

  /** Whether the dropdown list is showing. */
  get isOpen(): boolean {
    return this.view.visible;
  }

  /**
   * Move the selection without opening the list. `Select` only writes its
   * closed and open labels from a row press.
   */
  selectIndex(index: number, text: string): void {
    this.value = index;
    this.openButton.text = text;
    this.closeButton.text = text;
  }

  /**
   * Put the closed button's face into `state`. Its own pointer handlers write
   * the same field.
   */
  setClosedState(state: "default" | "hover" | "pressed"): void {
    this.openButton.setState(state);
  }

  /**
   * The closed button's size. Readable while the dropdown is open, when that
   * button is hidden and the dropdown sits on the stage, so this Select's own
   * bounds are empty.
   */
  get closedSize(): { width: number; height: number } {
    const bounds = this.openButton.getLocalBounds();
    return { width: bounds.width, height: bounds.height };
  }

  /**
   * The rows of the list. `Select` builds each as a `FancyButton` in
   * `convertItemsToButtons`; the scroll box types its items as plain
   * containers.
   */
  private get rows(): readonly FancyButton[] {
    return (this.scrollBox?.items ?? []) as unknown as readonly FancyButton[];
  }

  get highlighted(): number {
    return this._highlight;
  }

  /**
   * Light the row nearest `index` as the one a confirm press commits, and
   * bring it into the visible part of the list. `Select` has no highlight of
   * its own, so the light is the row's hover face.
   */
  highlightRow(index: number): void {
    const rows = this.rows;
    const previous = rows[this._highlight];
    if (previous !== undefined) previous.setState("default");
    const next = Math.min(Math.max(index, 0), rows.length - 1);
    const row = rows[next];
    // An empty list lights nothing, and clamping leaves `next` at -1.
    this._highlight = row === undefined ? -1 : next;
    if (row === undefined) return;
    row.setState("hover");
    this.scrollBox?.scrollTo(next);
  }

  /** Give the light back to the pointer, as the list closes. */
  clearHighlight(): void {
    const row = this.rows[this._highlight];
    this._highlight = -1;
    if (row !== undefined) row.setState("default");
  }

  /**
   * Run the highlighted row's own press. `Select` hangs the whole commit on
   * it: the value, `onSelect`, both labels and the close. A list with no rows
   * closes.
   */
  pressHighlighted(): void {
    const row = this.rows[this._highlight];
    if (row === undefined) {
      this.close();
      return;
    }
    row.onPress.emit();
  }

  replaceItems(
    items: Parameters<Select["addItems"]>[0],
    selected: number,
  ): void {
    this.scrollBox?.removeItems();
    if (items.items.length === 0) {
      this.openButton.text = "";
      this.closeButton.text = "";
      this.value = -1;
      return;
    }
    this.addItems(items, selected);
    this.value = selected;
    if (this.isOpen) this.highlightRow(selected);
  }
}

const DEFAULT_SELECTED = 0;

function selectedForItems(requested: number, itemCount: number): number {
  if (itemCount === 0) return DEFAULT_SELECTED;
  return Math.min(Math.max(requested, 0), itemCount - 1);
}

function selectItems(
  props: PixiSelectProps,
): Parameters<Select["addItems"]>[0] {
  return {
    items: props.items,
    backgroundColor: props.itemBG ?? 0x000000,
    width: props.itemWidth ?? 200,
    height: props.itemHeight ?? 40,
    ...(props.itemHoverBG !== undefined
      ? { hoverColor: props.itemHoverBG }
      : {}),
    ...(props.itemTextStyle !== undefined || props.textStyle !== undefined
      ? { textStyle: props.itemTextStyle ?? props.textStyle }
      : {}),
    radius: 0,
  };
}

/**
 * Yoga-aware wrapper around @pixi/ui Select (dropdown).
 *
 * While closed, a confirm press opens the list, and left and right step the
 * selection. The open list takes the input of the focus scope around it: up
 * and down move the highlighted row, confirm commits it and closes, cancel
 * closes on the value the select already had, and left and right do nothing.
 * Anything that closes the list hands the scope's input back.
 */
export class PixiSelect
  extends PixiUIBase<PortalSelect>
  implements UIInputCaptureElement
{
  constructor(props: PixiSelectProps) {
    const view = new PortalSelect({
      closedBG: resolvePixiView(props.closedBG),
      openBG: resolvePixiView(props.openBG),
      textStyle: props.textStyle,
      selected: props.selected ?? DEFAULT_SELECTED,
      scrollBoxOffset: props.scrollBoxOffset,
      visibleItems: props.visibleItems,
      items: selectItems(props),
    } as ConstructorParameters<typeof Select>[0]);
    super(view, props);

    // Lift the open dropdown above sibling UI; drop it back on close. Every
    // path that opens or closes the list runs through here, so the list, the
    // row highlight and the scope's input turn over together.
    view.onOpenChange = (open) => {
      if (open) {
        view.portalDropdown();
        view.highlightRow(this.currentIndex());
      } else {
        view.restoreDropdown();
        view.clearHighlight();
      }
      captureFocusInput(this, open);
    };

    this.bridgeSignal(view.onSelect, "onSelect", "UI onSelect", { ...props });
    this.prevProps = { ...props };
  }

  /** Select is a composite: a closed button over a scrolling list. Sizing its
   *  container scales both out of shape, so it keeps its own size. */
  protected override sizedByLayout(): boolean {
    return false;
  }

  /**
   * The closed button's box. While the list is open the button is hidden and
   * the list draws on the stage, so this container draws nothing to outline.
   */
  protected override focusOutlineBox(): UIFocusOutlineBox {
    const { width, height } = this.view.closedSize;
    return { x: 0, y: 0, width, height };
  }

  /** Open or close the dropdown. */
  activate(): void {
    this.view.toggle();
  }

  /**
   * The row the select is on: the one the player picked, or the one the game
   * authored until then, because `Select.value` is `-1` until a row is
   * pressed.
   */
  private currentIndex(): number {
    if (this.view.value >= 0) return this.view.value;
    return (this.prevProps.selected as number | undefined) ?? DEFAULT_SELECTED;
  }

  /**
   * Walk the open list. Up and down stop at either end without wrapping, and
   * the press is kept either way, so it never reaches the menu behind the
   * list. Left and right do nothing: the open list is handed every direction,
   * so `adjust` and a game's `onAdjust` wait until it closes.
   */
  moveCapture(direction: FocusDirection): void {
    if (direction !== "up" && direction !== "down") return;
    this.view.highlightRow(
      this.view.highlighted + (direction === "down" ? 1 : -1),
    );
  }

  /** Commit the highlighted row, which closes the list. */
  confirmCapture(): void {
    this.view.pressHighlighted();
  }

  /** Close the list on the value the select already had. */
  cancelCapture(): void {
    this.view.close();
  }

  /** Focus leaving the select, or its menu losing the keys, closes the list. */
  releaseCapture(): void {
    this.cancelCapture();
  }

  protected override setPressed(pressed: boolean): void {
    if (pressed) {
      this.view.setClosedState("pressed");
      return;
    }
    this.view.setClosedState(this.hovered ? "hover" : "default");
  }

  /**
   * Step the closed select on left and right. At either end the press is not
   * consumed, so focus leaves the dropdown. An open list routes every
   * direction to {@link moveCapture}, so this never runs while it shows.
   */
  protected override adjust(direction: FocusDirection): boolean {
    if (direction !== "left" && direction !== "right") return false;
    const items = (this.prevProps.items as string[] | undefined) ?? [];
    const current = this.currentIndex();
    const next = current + (direction === "right" ? 1 : -1);
    if (next < 0 || next >= items.length) return false;
    const text = items[next] ?? "";
    this.view.selectIndex(next, text);
    // `Select` emits `onSelect` only from a row press, so a stepped selection
    // emits it here. The signal carries the error-boundary-wrapped callback.
    this.view.onSelect.emit(next, text);
    return true;
  }

  /** The open list is an overlay on the stage and the closed button is hidden
   *  while it shows, so layout follows the closed button at all times. */
  protected override intrinsicSize(): { width: number; height: number } {
    return this.view.closedSize;
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as Partial<PixiSelectProps>;

    this.bridgeSignal(this.view.onSelect, "onSelect", "UI onSelect", props);

    if ("items" in p) {
      const merged = {
        ...this.prevProps,
        ...props,
      } as unknown as PixiSelectProps;
      // A replacement list keeps the row the player is on unless this update
      // names one, so re-labelling the rows does not reset the choice.
      // `Select.value` is -1 until the player picks a row, so an authored
      // `selected` owns the row until then.
      const requested =
        "selected" in p
          ? (p.selected ?? DEFAULT_SELECTED)
          : this.view.value >= 0
            ? this.view.value
            : (merged.selected ?? DEFAULT_SELECTED);
      const selected = selectedForItems(requested, merged.items.length);
      this.view.replaceItems(selectItems(merged), selected);
      this.invalidateSize();
    } else if ("selected" in p) {
      const merged = {
        ...this.prevProps,
        ...props,
      } as unknown as PixiSelectProps;
      this.view.replaceItems(
        selectItems(merged),
        p.selected ?? DEFAULT_SELECTED,
      );
      this.invalidateSize();
    }

    this.updateBase(props);
  }

  override destroy(): void {
    // Hand the scope's input back before anything is torn down.
    captureFocusInput(this, false);
    // Put the dropdown back inside the Select first, so `view.destroy()` tears
    // it down instead of leaking a container reparented to the stage.
    this.view.restoreDropdown();
    super.destroy();
  }

  protected disconnectAll(): void {
    this.disconnectBridgedSignal(this.view.onSelect, "onSelect");
  }
}
