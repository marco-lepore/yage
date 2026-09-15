import type { Scene } from "@yagejs/core";
import type {
  ActionMenuPresenter,
  DiagnosticSink,
  PresentedAction,
} from "@yagejs-addons/inventory";
import { LocalizedPresenterState, type InventoryMessageKeys } from "./keys.js";

/**
 * Wraps an action-menu presenter so row labels follow the locale. Labels are
 * substituted before the inner presenter measures them, so a longer
 * translation widens the menu. On a locale change an open menu is redrawn
 * with the new labels, keeping its highlighted row and visibility.
 */
class LocalizedActionMenu implements ActionMenuPresenter {
  private readonly state = new LocalizedPresenterState();
  private actions: readonly PresentedAction[] | undefined;
  private slot = 0;
  private highlighted = 0;
  private visible = false;

  constructor(
    private readonly inner: ActionMenuPresenter,
    private readonly keys: InventoryMessageKeys,
  ) {
    if (inner.actionAtPoint) {
      this.actionAtPoint = (x, y) => inner.actionAtPoint!(x, y);
    }
    if (inner.setDiagnostics) {
      this.setDiagnostics = (warn) => inner.setDiagnostics!(warn);
    }
    if (inner.update) this.update = (dt) => inner.update!(dt);
  }

  readonly actionAtPoint?: (x: number, y: number) => number | undefined;
  readonly setDiagnostics?: (warn: DiagnosticSink) => void;
  readonly update?: (dt: number) => void;

  /** The session assigns this; the inner presenter, which fires it, must
   *  hold the same handler. Write-only: nothing reads it back. */
  set onActionChosen(handler: (position: number) => void) {
    this.inner.onActionChosen = handler;
  }

  mount(scene: Scene): void {
    this.inner.mount(scene);
    this.state.mount(scene, () => {
      if (!this.actions) return;
      this.present(this.actions, this.slot);
      this.inner.setVisible(this.visible);
      this.inner.highlight(this.highlighted);
    });
  }

  dispose(): void {
    this.state.unmount();
    this.actions = undefined;
    this.inner.dispose();
  }

  present(actions: readonly PresentedAction[], slot: number): void {
    this.actions = actions;
    this.slot = slot;
    const key = this.keys.action;
    this.inner.present(
      key
        ? actions.map((a) => ({
            id: a.id,
            label: this.state.text(key(a.id), a.label),
          }))
        : actions,
      slot,
    );
  }

  highlight(position: number): void {
    this.highlighted = position;
    this.inner.highlight(position);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.inner.setVisible(visible);
  }

  clear(): void {
    this.actions = undefined;
    this.inner.clear();
  }
}

export function localizedActionMenu(
  menu: ActionMenuPresenter,
  keys: InventoryMessageKeys,
): ActionMenuPresenter {
  return new LocalizedActionMenu(menu, keys);
}
