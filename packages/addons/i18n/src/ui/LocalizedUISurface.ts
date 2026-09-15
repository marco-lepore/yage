import type { TextStyle } from "@yagejs/renderer";
import {
  UISurface,
  type UIButton,
  type UIButtonProps,
  type UIElement,
  type UIPanel,
  type UIText,
} from "@yagejs/ui";
import { localizationFor, type Relocalizable } from "../core/Localization.js";
import {
  formatFallback,
  isMessage,
  type Message,
  type MessageResolver,
} from "../core/message.js";
import { relocalizeTree } from "./relocalizeTree.js";
import { UILocalizedButton } from "./UILocalizedButton.js";
import { UILocalizedText } from "./UILocalizedText.js";

/**
 * A `UISurface` whose `text` and `button` builders also take a
 * {@link Message}, and whose element tree follows the current locale: on
 * every locale change the plugin's update pass reaches this component and it
 * calls `relocalize` on every element under its root that implements it,
 * however deeply nested. Elements built before the surface is added to a
 * scene show their fallback until then.
 */
export class LocalizedUISurface extends UISurface implements Relocalizable {
  private _resolve: MessageResolver = formatFallback;

  /** Add a text element. A `Message` makes a {@link UILocalizedText}. */
  override text(
    content: Message,
    style?: Partial<TextStyle>,
    parent?: UIPanel,
  ): UILocalizedText;
  override text(
    content: string,
    style?: Partial<TextStyle>,
    parent?: UIPanel,
  ): UIText;
  override text(
    content: string | Message,
    style?: Partial<TextStyle>,
    parent: UIPanel = this.root,
  ): UIText {
    if (!isMessage(content)) return parent.text(content, style);
    const element = new UILocalizedText({
      message: content,
      resolve: this._resolve,
      ...(style ? { style } : {}),
    });
    parent.addElement(element);
    return element;
  }

  /**
   * Add a button. A `Message` label becomes a {@link UILocalizedButton}, whose
   * label keeps the button's own `textStyle`, `bitmap` and `truncate`.
   */
  override button(
    label: Message,
    opts: Omit<UIButtonProps, "children">,
    parent?: UIPanel,
  ): UILocalizedButton;
  override button(
    label: string,
    opts: Omit<UIButtonProps, "children">,
    parent?: UIPanel,
  ): UIButton;
  override button(
    label: string | Message,
    opts: Omit<UIButtonProps, "children">,
    parent: UIPanel = this.root,
  ): UIButton {
    if (!isMessage(label)) return parent.button(label, opts);
    const button = new UILocalizedButton({
      ...opts,
      message: label,
      resolve: this._resolve,
    });
    parent.addElement(button);
    return button;
  }

  /**
   * Add an element and resolve it for the current locale. `parent` defaults
   * to the root; pass a panel to nest. An element added with a panel's own
   * `addElement` shows its fallback until the next locale change.
   */
  override addElement(child: UIElement, parent: UIPanel = this.root): void {
    parent.addElement(child);
    relocalizeTree(child, this._resolve);
  }

  /** Re-resolve every relocalizable element under the root. */
  relocalize(resolve: MessageResolver): void {
    this._resolve = resolve;
    relocalizeTree(this.root, resolve);
  }

  override onAdd(): void {
    super.onAdd();
    const localization = localizationFor(this);
    this.relocalize((message, values) => localization.resolve(message, values));
  }
}
