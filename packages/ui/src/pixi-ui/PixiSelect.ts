import { FancyButton, Select } from "@pixi/ui";
import { Container } from "pixi.js";
import { LocalizedTextController, resolveStatic } from "@yagejs/core";
import type { PixiSelectProps } from "../types.js";
import { PixiUIBase } from "./PixiUIBase.js";
import { refitButtonText } from "./PixiFancyButton.js";
import { resolvePixiView } from "./view-resolver.js";

// The dropdown is reparented directly under the stage (above the fit-scaled
// world root that holds every scene layer), so any positive zIndex wins.
const DROPDOWN_Z = 2_000_000;

/** Walk to the top of the display tree (the renderer's stage). */
function topAncestor(node: Container): Container {
  let n: Container = node;
  while (n.parent) n = n.parent;
  return n;
}

/**
 * @pixi/ui `Select` bakes each option's string into its dropdown button, its
 * press handler, and the closed/selected label at construction, with no public
 * setter for any of them. Worse, the strings are captured before the
 * localization plugin is attached, so they are always the untranslated
 * defaults. And it renders the dropdown list inline, at the Select's own
 * z-position, so a sibling drawn later paints over the open list.
 *
 * This subclass reaches the protected internals to (a) relocalize in place
 * without rebuilding (which would drop open / scroll state), and (b) lift the
 * open dropdown above all other UI:
 *
 * - `setItemLabel` swaps a dropdown button's visible text only — it never
 *   touches the button's `onPress`, so `FancyButton`'s own press-state listener
 *   and `Select`'s selection handler stay connected.
 * - `setSelectedLabel` refreshes the closed/open button showing the current
 *   choice.
 * - `connectItemPress` adds a later-ordered `onPress` handler that runs *after*
 *   `Select`'s own (which emits and sets the closed label with the stale
 *   default), letting the wrapper overwrite both with the current translation.
 * - `portalDropdown` / `restoreDropdown` reparent the dropdown container to the
 *   top of the render tree while open (position and scale preserved via the
 *   world transform), so it draws above sibling UI like a web dropdown.
 */
class LocalizedSelect extends Select {
  private itemButton(id: number): FancyButton | undefined {
    return (this.scrollBox?.items as FancyButton[] | undefined)?.[id];
  }

  setItemLabel(id: number, text: string): void {
    const button = this.itemButton(id);
    if (button) {
      button.text = text;
      // `FancyButton.set text` skips the fit pass — re-fit so a longer
      // translation doesn't overflow the dropdown button.
      refitButtonText(button);
    }
  }

  setSelectedLabel(text: string): void {
    this.openButton.text = text;
    this.closeButton.text = text;
    refitButtonText(this.openButton);
    refitButtonText(this.closeButton);
  }

  /** Runs after Select's own item handler (order 1 > default 0). */
  connectItemPress(id: number, cb: () => void): void {
    this.itemButton(id)?.onPress.connect(cb, 1);
  }

  disconnectItemPress(id: number, cb: () => void): void {
    this.itemButton(id)?.onPress.disconnect(cb);
  }

  /** Every dropdown option button — for teardown: `ScrollBox.destroy()`
   *  detaches its List children without destroying them, so the wrapper must
   *  destroy the survivors itself. */
  allItemButtons(): FancyButton[] {
    return [...((this.scrollBox?.items as FancyButton[] | undefined) ?? [])];
  }

  /** Tear down the dropdown list. `ScrollBox.destroy()` removes a document
   *  `wheel` listener that a plain `Select.destroy()` leaves attached. */
  destroyScrollBox(): void {
    const box = this.scrollBox;
    if (box && !box.destroyed) box.destroy({ children: true, context: true });
  }

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
}

/** Yoga-aware wrapper around @pixi/ui Select (dropdown). */
export class PixiSelect extends PixiUIBase<LocalizedSelect> {
  /** Current resolved label per option — the single source of truth for the
   *  selected label and the emitted `onSelect` text (Select baked stale
   *  defaults into its own handlers). */
  private readonly _texts: string[];
  private _onSelect: ((index: number, text: string) => void) | undefined;
  /** Item-press handlers connected onto the dropdown buttons, tracked so
   *  teardown can disconnect them — the buttons outlive `view.destroy()` (it
   *  doesn't destroy the child ScrollBox), so an undisconnected closure would
   *  keep this wrapper alive. */
  private readonly _itemPresses: { id: number; cb: () => void }[] = [];

  constructor(props: PixiSelectProps) {
    const texts = props.items.map(resolveStatic);
    const view = new LocalizedSelect({
      closedBG: resolvePixiView(props.closedBG),
      openBG: resolvePixiView(props.openBG),
      textStyle: props.textStyle,
      selected: props.selected,
      scrollBoxOffset: props.scrollBoxOffset,
      visibleItems: props.visibleItems,
      items: {
        items: texts,
        backgroundColor: props.itemBG ?? 0x000000,
        width: props.itemWidth ?? 200,
        height: props.itemHeight ?? 40,
        hoverColor: props.itemHoverBG,
        textStyle: props.itemTextStyle ?? props.textStyle,
        radius: 0,
      },
    } as ConstructorParameters<typeof Select>[0]);
    super(view, props);

    this._texts = texts;
    this._onSelect = props.onSelect;

    // `Select.value` starts at -1 and is only set on a click; align it with the
    // initially-shown selection so relocalization refreshes the right label.
    view.value = props.selected ?? 0;

    props.items.forEach((item, i) => {
      // After Select's handler emits + sets the stale label, correct both from
      // `_texts` and hand the caller the current translation.
      const press = (): void => {
        const text = this._texts[i] ?? "";
        view.setSelectedLabel(text);
        this._onSelect?.(i, text);
      };
      this._itemPresses.push({ id: i, cb: press });
      view.connectItemPress(i, press);
      // Re-resolve this option's dropdown label on locale change (and the
      // closed label when it is the current selection).
      const localizer = new LocalizedTextController((value) => {
        this._texts[i] = value;
        this.view.setItemLabel(i, value);
        if (this.view.value === i) this.view.setSelectedLabel(value);
      });
      this.localizers.push(localizer);
      localizer.seed(item);
    });

    // Lift the open dropdown above sibling UI; drop it back on close.
    view.onOpenChange = (open) => {
      if (open) view.portalDropdown();
      else view.restoreDropdown();
    };

    this.prevProps = { ...props };
  }

  /** Select is a composite (FancyButton + ScrollBox). Setting container.width/height
   *  changes scale and breaks the internal layout, so we skip resizing. */
  override applyLayout(): void {
    // position only — no resize
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as PixiSelectProps;

    // `items` is construction-only: @pixi/ui bakes the options (buttons, press
    // handlers) at build time, so a new `items` array here is NOT applied — the
    // buttons, `_texts`, and per-item localizers stay bound to the constructor
    // set (localization still refreshes their labels in place). Changing which
    // options exist means recreating the component.
    if ("onSelect" in props) this._onSelect = p.onSelect;
    // Refresh the shown label too — `value` alone leaves the closed/open button
    // on the previous selection's text until the next locale bump.
    if ("selected" in props) {
      const next = p.selected ?? 0;
      this.view.value = next;
      this.view.setSelectedLabel(this._texts[next] ?? "");
    }

    this.updateBase(props);
  }

  protected disconnectAll(): void {
    // The item buttons outlive `view.destroy()` (it leaves the child ScrollBox
    // intact), so disconnect each handler explicitly rather than relying on the
    // button teardown; then drop the callback.
    for (const { id, cb } of this._itemPresses) {
      this.view.disconnectItemPress(id, cb);
    }
    this._itemPresses.length = 0;
    this._onSelect = undefined;
  }

  override destroy(): void {
    // Put the dropdown back inside the Select first (portal), so it is torn
    // down here instead of leaking a container reparented to the stage.
    this.view.restoreDropdown();
    // The dropdown is Select's own internal, so this wrapper owns its teardown
    // (the base destroy deliberately spares children — they include views the
    // game passed in). `ScrollBox.destroy()` detaches its List children without
    // destroying them, so collect the option buttons first and destroy the
    // survivors; otherwise repeated mount/unmount cycles leak their Pixi
    // objects and press signals.
    const buttons = this.view.allItemButtons();
    this.view.destroyScrollBox();
    super.destroy();
    for (const b of buttons) {
      if (!b.destroyed) b.destroy({ children: true, context: true });
    }
  }
}
