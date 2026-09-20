import { Input } from "@pixi/ui";
import type { DestroyOptions } from "@yagejs/renderer";
import type { PixiInputProps } from "../types.js";
import type { UIInputCaptureElement } from "../focus/input-capture.js";
import { captureFocusInput } from "../focus/input-capture.js";
import { PixiUIBase } from "./PixiUIBase.js";
import { resolvePixiView } from "./view-resolver.js";

const DEFAULT_VALUE = "";
const DEFAULT_PLACEHOLDER = "";
const DEFAULT_SECURE = false;
const DEFAULT_PADDING = 0;

/**
 * @pixi/ui Input with a placeholder that can change after construction, an
 * edit lifecycle a focus scope can drive, and the value it held when editing
 * began so a cancel can put it back.
 *
 * The base class keeps the placeholder text as a protected field and only
 * recomputes its visibility from its own `value` setter and edit start/stop.
 */
class YageInput extends Input {
  /** Told when the field gains or loses the caret. */
  onEditingChange: ((editing: boolean) => void) | undefined;
  private _valueAtEditStart = "";

  setPlaceholder(text: string): void {
    if (!this.placeholder) return;
    this.placeholder.text = text;
    this.placeholder.visible = this.value.length === 0 && !this.editing;
  }

  /** Whether the field holds the caret. */
  get isEditing(): boolean {
    return this.editing;
  }

  /** Put the caret in the field, as a tap on it does. */
  beginEditing(): void {
    if (this.editing) return;
    this._startEditing();
  }

  /** Take the caret away, keeping what was typed. */
  endEditing(): void {
    this.stopEditing();
  }

  /** Take the caret away, putting back the value editing began with. */
  cancelEditing(): void {
    this.value = this._valueAtEditStart;
    this.stopEditing();
  }

  /**
   * `Input` binds this as the hidden DOM field's `keydown` listener, despite
   * its name. The base treats Escape as Enter and keeps what was typed; here
   * Escape restores the value the edit began with.
   */
  protected override onKeyUp(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      this.cancelEditing();
      return;
    }
    super.onKeyUp(e);
  }

  protected override _startEditing(): void {
    this._valueAtEditStart = this.value;
    super._startEditing();
    this.onEditingChange?.(true);
  }

  protected override stopEditing(): void {
    // The base returns early for a field that is not editing.
    const wasEditing = this.editing;
    super.stopEditing();
    if (wasEditing) this.onEditingChange?.(false);
  }

  override destroy(options?: DestroyOptions | boolean): void {
    // `Input.destroy()` leaves an edit in progress running, and a field
    // recorded as editing makes every focus scope poll only confirm and
    // cancel.
    this.stopEditing();
    super.destroy(options);
  }
}

/** Yoga-aware wrapper around @pixi/ui Input. */
export class PixiInput
  extends PixiUIBase<YageInput>
  implements UIInputCaptureElement
{
  constructor(props: PixiInputProps) {
    const view = new YageInput({
      bg: resolvePixiView(props.bg),
      textStyle: props.textStyle,
      placeholder: props.placeholder,
      value: props.value ?? DEFAULT_VALUE,
      maxLength: props.maxLength,
      secure: props.secure ?? DEFAULT_SECURE,
      align: props.align,
      padding: props.padding ?? DEFAULT_PADDING,
      nineSliceSprite: props.nineSliceSprite,
    } as ConstructorParameters<typeof Input>[0]);
    super(view, props);

    // The field holds its scope's input for as long as it holds the caret.
    view.onEditingChange = (editing): void => {
      captureFocusInput(this, editing);
    };

    this.bridgeSignal(view.onChange, "onChange", "UI onChange", { ...props });
    this.bridgeSignal(view.onEnter, "onEnter", "UI onEnter", { ...props });
    this.prevProps = { ...props };
  }

  /** Whether the field holds the caret. */
  get isEditing(): boolean {
    return this.view.isEditing;
  }

  /**
   * Put the caret in the field. While it holds the caret the field takes the
   * input of the focus scope around it, so typed keys do not walk the menu.
   * Enter commits what was typed and Escape restores the value the edit began
   * with.
   *
   * Every way of leaving the field emits its `onEnter`; after
   * {@link cancelEditing} it carries the restored value.
   */
  activate(): void {
    this.view.beginEditing();
  }

  /** Stop editing, keeping what was typed. */
  commitEditing(): void {
    this.view.endEditing();
  }

  /** Put back the value captured when editing began, then stop editing. */
  cancelEditing(): void {
    this.view.cancelEditing();
  }

  confirmCapture(): void {
    this.commitEditing();
  }

  cancelCapture(): void {
    this.cancelEditing();
  }

  /** Focus leaving the field, or its menu losing the keys, keeps the text. */
  releaseCapture(): void {
    this.commitEditing();
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as Partial<PixiInputProps>;

    this.bridgeSignal(this.view.onChange, "onChange", "UI onChange", props);
    this.bridgeSignal(this.view.onEnter, "onEnter", "UI onEnter", props);

    if ("value" in p) {
      this.view.value = p.value ?? DEFAULT_VALUE;
      this.invalidateSize();
    }
    if ("placeholder" in p) {
      this.view.setPlaceholder(p.placeholder ?? DEFAULT_PLACEHOLDER);
      this.invalidateSize();
    }
    if ("secure" in p) this.view.secure = p.secure ?? DEFAULT_SECURE;
    if ("padding" in p) {
      this.view.padding = (p.padding ?? DEFAULT_PADDING) as Input["padding"];
    }

    this.updateBase(props);
  }

  protected disconnectAll(): void {
    this.disconnectBridgedSignal(this.view.onChange, "onChange");
    this.disconnectBridgedSignal(this.view.onEnter, "onEnter");
  }
}
