import type { Localization } from "@yagejs/core";
import type { UIElement } from "./types.js";

/**
 * Localization propagation for a container element. Holds the attached service
 * and fans `attachLocalization` / `detachLocalization` out to children; wires a
 * child added after the container went live, and unwires a removed / moved one.
 *
 * A container owns one of these and forwards its `attachLocalization` /
 * `detachLocalization` (and `addElement` / `removeElement`) to it, so a
 * `LocalizedBinding` anywhere in the tree re-resolves on locale change.
 */
export class ContainerLocalization {
  private _localization: Localization | undefined;
  private _attached = false;

  attach(
    children: Iterable<UIElement>,
    localization: Localization | undefined,
  ): void {
    this._localization = localization;
    this._attached = true;
    for (const child of children) child.attachLocalization?.(localization);
  }

  detach(children: Iterable<UIElement>): void {
    for (const child of children) child.detachLocalization?.();
    this._attached = false;
    this._localization = undefined;
  }

  /** Wire a child added after attach; a no-op before the container is live. */
  attachChild(child: UIElement): void {
    if (this._attached) child.attachLocalization?.(this._localization);
  }

  /** Unwire a removed / moved child. */
  detachChild(child: UIElement): void {
    child.detachLocalization?.();
  }
}
