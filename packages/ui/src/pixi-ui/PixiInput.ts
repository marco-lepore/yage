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
   * Every key the hidden DOM field receives, despite the base class's name
   * for it: `Input` binds this as the field's `keydown` listener.
   *
   * Escape is the cancel key, so it leaves the field on the value the edit
   * began with — the end the surrounding focus scope gives it as well. The
   * base treats Escape as it treats Enter and keeps what was typed.
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
    // The base returns early for a field that is not editing, so the record
    // of who holds the caret follows the same guard.
    const wasEditing = this.editing;
    super.stopEditing();
    if (wasEditing) this.onEditingChange?.(false);
  }

  override destroy(options?: DestroyOptions | boolean): void {
    // `Input.destroy()` leaves an edit in progress running, and one field
    // recorded as editing makes every focus scope poll nothing but confirm
    // and cancel for the rest of the session.
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

    // The caret is what makes the field answer the player, so the field holds
    // its scope's input for exactly as long as it has one.
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
   * Put the caret in the field. A field holding the caret takes the input of
   * the focus scope around it, so the typed keys reach the field rather than
   * walking the menu. Enter typed into the field commits what was typed and
   * Escape restores the value the edit began with, the two ends the scope's
   * confirm and cancel give it.
   *
   * Leaving the field any way emits its `onEnter`, because that is what ends
   * every edit; after {@link cancelEditing} it carries the restored value.
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

  /** Confirm ends the edit on what was typed. */
  confirmCapture(): void {
    this.commitEditing();
  }

  /** Cancel ends it on the value the field held when the caret arrived. */
  cancelCapture(): void {
    this.cancelEditing();
  }

  /**
   * Focus moving off the field, or its menu losing the keys, ends the edit on
   * what was typed — the same end a click somewhere else gives it.
   */
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
