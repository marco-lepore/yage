import { Select } from "@pixi/ui";
import { Container } from "pixi.js";
import type { PixiSelectProps } from "../types.js";
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

/** Yoga-aware wrapper around @pixi/ui Select (dropdown). */
export class PixiSelect extends PixiUIBase<PortalSelect> {
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

    // Lift the open dropdown above sibling UI; drop it back on close.
    view.onOpenChange = (open) => {
      if (open) view.portalDropdown();
      else view.restoreDropdown();
    };

    this.bridgeSignal(view.onSelect, "onSelect", "UI onSelect", { ...props });
    this.prevProps = { ...props };
  }

  /** Select is a composite (FancyButton + ScrollBox). Setting container.width/height
   *  changes scale and breaks the internal layout, so we skip resizing. */
  override applyLayout(): void {
    // position only — no resize
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as Partial<PixiSelectProps>;

    this.bridgeSignal(this.view.onSelect, "onSelect", "UI onSelect", props);

    if ("items" in p) {
      const merged = {
        ...this.prevProps,
        ...props,
      } as unknown as PixiSelectProps;
      const requested = merged.selected ?? DEFAULT_SELECTED;
      const selected = selectedForItems(requested, merged.items.length);
      this.view.replaceItems(selectItems(merged), selected);
    } else if ("selected" in p) {
      const merged = {
        ...this.prevProps,
        ...props,
      } as unknown as PixiSelectProps;
      this.view.replaceItems(
        selectItems(merged),
        p.selected ?? DEFAULT_SELECTED,
      );
    }

    this.updateBase(props);
  }

  override destroy(): void {
    // Put the dropdown back inside the Select first, so `view.destroy()` tears
    // it down instead of leaking a container reparented to the stage.
    this.view.restoreDropdown();
    super.destroy();
  }

  protected disconnectAll(): void {
    this.disconnectBridgedSignal(this.view.onSelect, "onSelect");
  }
}
