import type { Scene } from "@yagejs/core";
import type {
  ChromePresenter,
  DiagnosticSink,
  InventoryChromeInfo,
} from "@yagejs-addons/inventory";
import { LocalizedPresenterState, type InventoryMessageKeys } from "./keys.js";

/** Wraps a chrome presenter so the header title follows the locale: the
 *  controller's `title` string is the fallback for `keys.title`. */
class LocalizedChrome implements ChromePresenter {
  private readonly state = new LocalizedPresenterState("chrome");
  private info: InventoryChromeInfo | undefined;

  constructor(
    private readonly inner: ChromePresenter,
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
      if (this.info) this.present(this.info);
    });
  }

  dispose(): void {
    this.state.unmount();
    this.info = undefined;
    this.inner.dispose();
  }

  present(info: InventoryChromeInfo): void {
    this.info = info;
    const key = this.keys.title;
    this.inner.present(
      key !== undefined && info.title !== undefined
        ? { ...info, title: this.state.text(key, info.title) }
        : info,
    );
  }

  setVisible(visible: boolean): void {
    this.inner.setVisible(visible);
  }
}

export function localizedChrome(
  chrome: ChromePresenter,
  keys: InventoryMessageKeys,
): ChromePresenter {
  return new LocalizedChrome(chrome, keys);
}
