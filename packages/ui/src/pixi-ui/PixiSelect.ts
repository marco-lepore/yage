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

  // The buttons call `toggle()` directly (not `open`/`close`), so hook all
  // three to catch every path to a state change.
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
    host.sortableChildren = true;
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
    // `view` is the Select's first child (added before `openButton`).
    this.addChildAt(this.view, 0);
  }
}

/** Yoga-aware wrapper around @pixi/ui Select (dropdown). */
export class PixiSelect extends PixiUIBase<PortalSelect> {
  constructor(props: PixiSelectProps) {
    const view = new PortalSelect({
      closedBG: resolvePixiView(props.closedBG),
      openBG: resolvePixiView(props.openBG),
      textStyle: props.textStyle,
      selected: props.selected,
      scrollBoxOffset: props.scrollBoxOffset,
      visibleItems: props.visibleItems,
      items: {
        items: props.items,
        backgroundColor: props.itemBG ?? 0x000000,
        width: props.itemWidth ?? 200,
        height: props.itemHeight ?? 40,
        hoverColor: props.itemHoverBG,
        textStyle: props.itemTextStyle ?? props.textStyle,
        radius: 0,
      },
    } as ConstructorParameters<typeof Select>[0]);
    super(view, props);

    // Lift the open dropdown above sibling UI; drop it back on close.
    view.onOpenChange = (open) => {
      if (open) view.portalDropdown();
      else view.restoreDropdown();
    };

    if (props.onSelect) view.onSelect.connect(props.onSelect);
    this.prevProps = { ...props };
  }

  /** Select is a composite (FancyButton + ScrollBox). Setting container.width/height
   *  changes scale and breaks the internal layout, so we skip resizing. */
  override applyLayout(): void {
    // position only — no resize
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as PixiSelectProps;

    this.bridgeSignal(this.view.onSelect, "onSelect", props);

    if (p.selected !== undefined) this.view.value = p.selected;

    this.updateBase(props);
  }

  override destroy(): void {
    // Put the dropdown back inside the Select first, so `view.destroy()` tears
    // it down instead of leaking a container reparented to the stage.
    this.view.restoreDropdown();
    super.destroy();
  }

  protected disconnectAll(): void {
    const cb = this.prevProps.onSelect as
      | ((index: number, text: string) => void)
      | undefined;
    if (cb) this.view.onSelect.disconnect(cb);
  }
}
