import type { Scene } from "@yagejs/core";
import type {
  DetailPresenter,
  DiagnosticSink,
  SlotView,
} from "@yagejs-addons/inventory";
import { LocalizedPresenterState, type InventoryMessageKeys } from "./keys.js";
import { localizeSlotView } from "./localizedSlots.js";

/** Wraps a detail presenter so the selected item's name and description
 *  follow the locale; re-presents the current item on a locale change. */
class LocalizedDetail implements DetailPresenter {
  private readonly state = new LocalizedPresenterState();
  private current: SlotView | null | undefined;

  constructor(
    private readonly inner: DetailPresenter,
    private readonly keys: InventoryMessageKeys,
  ) {
    if (inner.setDiagnostics) {
      this.setDiagnostics = (warn) => inner.setDiagnostics!(warn);
    }
    if (inner.update) this.update = (dt) => inner.update!(dt);
  }

  readonly setDiagnostics?: (warn: DiagnosticSink) => void;
  readonly update?: (dt: number) => void;

  mount(scene: Scene): void {
    this.inner.mount(scene);
    this.state.mount(scene, () => {
      if (this.current !== undefined) this.present(this.current);
    });
  }

  dispose(): void {
    this.state.unmount();
    this.current = undefined;
    this.inner.dispose();
  }

  present(view: SlotView | null): void {
    this.current = view;
    this.inner.present(
      view ? localizeSlotView(view, this.keys, this.state) : null,
    );
  }

  setVisible(visible: boolean): void {
    this.inner.setVisible(visible);
  }

  clear(): void {
    this.current = undefined;
    this.inner.clear();
  }
}

export function localizedDetail(
  detail: DetailPresenter,
  keys: InventoryMessageKeys,
): DetailPresenter {
  return new LocalizedDetail(detail, keys);
}
