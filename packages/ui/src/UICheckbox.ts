import { Container, Graphics, Text } from "pixi.js";
import type { Node as YogaNode } from "yoga-layout";
import { Display, MeasureMode } from "yoga-layout";
import { buildTextOptions } from "@yagejs/renderer";
import type { DisplayContainer } from "@yagejs/renderer";
import type { UIElement, UICheckboxProps } from "./types.js";
import { createYogaNode, applyLayoutProps } from "./yoga-helpers.js";
import { applyConsumeInput, clearConsumeInput } from "./consume-input.js";
import { getUIDefaultTextStyle } from "./text-defaults.js";
import { PointerEvents } from "./pointer-events.js";
import { PRESS_FACTOR, scaleChannels } from "./internal/color.js";
import { FocusOutline, layoutBox } from "./internal/focus-outline.js";
import { FocusState } from "./focus/FocusState.js";
import {
  requestHoverFocus,
  requestPressFocus,
} from "./focus/pointer-request.js";
import { runUICallback } from "./error-boundary.js";

const DEFAULT_SIZE = 20;
const DEFAULT_BOX_COLOR = 0x666666;
const DEFAULT_CHECK_COLOR = 0xffffff;
const LABEL_GAP = 6;

/** Interactive checkbox with optional label. */
export class UICheckbox implements UIElement {
  readonly container: DisplayContainer;
  readonly yogaNode: YogaNode;

  get displayObject(): DisplayContainer {
    return this.container;
  }

  private box: Graphics;
  private checkmark: Graphics;
  private label: Text | undefined;
  private _checked: boolean;
  private _disabled = false;
  private _focused = false;
  private _size: number;
  private boxColor: number;
  private checkColor: number;
  private onChange: ((checked: boolean) => void) | undefined;
  private _destroyed = false;
  private _pressStartedHere = false;
  // One flag per device holding the row down. The box is darkened while
  // either is set, and each device clears only its own press.
  private _pointerPressed = false;
  private _focusPressed = false;
  private _isPressed = false;
  private readonly pointerEvents: PointerEvents;
  private readonly _focus: FocusState;
  private readonly _focusOutline: FocusOutline;

  constructor(props: UICheckboxProps) {
    this.yogaNode = createYogaNode();
    this.container = new Container();
    this.container.eventMode = "static";
    this.container.cursor = "pointer";
    applyConsumeInput(this.container, props.consumeInput);

    this._checked = props.checked ?? false;
    this._size = props.size ?? DEFAULT_SIZE;
    this.boxColor = props.boxColor ?? DEFAULT_BOX_COLOR;
    this.checkColor = props.checkColor ?? DEFAULT_CHECK_COLOR;
    this.onChange = props.onChange;

    // Box background
    this.box = new Graphics();
    this.container.addChild(this.box);
    this.drawBox();

    // Checkmark
    this.checkmark = new Graphics();
    this.container.addChild(this.checkmark);
    this.drawCheckmark();

    // Optional label
    if (props.label) {
      this.createLabel(props.label, props.labelStyle);
    }

    // Measure function for intrinsic sizing
    this.yogaNode.setMeasureFunc((width, widthMode) => {
      const labelW = this.label ? this.label.width : 0;
      const labelH = this.label ? this.label.height : 0;
      const totalW = this._size + (labelW > 0 ? LABEL_GAP + labelW : 0);
      const totalH = Math.max(this._size, labelH);

      let measuredWidth = totalW;
      if (widthMode === MeasureMode.Exactly) {
        measuredWidth = width;
      } else if (widthMode === MeasureMode.AtMost) {
        measuredWidth = Math.min(totalW, width);
      }

      return { width: measuredWidth, height: totalH };
    });

    applyLayoutProps(this.yogaNode, props);

    // Every listener writes the pointer's own press flag and repaints from
    // both flags. Hover only hovers the row; a press asks a focus scope to
    // bring focus here.
    this.container.on("pointerover", () => {
      if (this._disabled) return;
      requestHoverFocus(this);
    });
    this.container.on("pointerout", () => {
      if (this._disabled) return;
      this._pointerPressed = false;
      this.repaintPress();
    });
    this.container.on("pointerdown", () => {
      if (this._disabled) return;
      this._pressStartedHere = true;
      requestPressFocus(this);
      this._pointerPressed = true;
      this.repaintPress();
    });
    this.container.on("pointerup", () => {
      // A press that began elsewhere must not toggle this box.
      const shouldToggle = !this._disabled && this._pressStartedHere;
      this._pressStartedHere = false;
      this._pointerPressed = false;
      this.repaintPress();
      if (shouldToggle) this.activate();
    });
    this.container.on("pointerupoutside", () => {
      this._pressStartedHere = false;
      this._pointerPressed = false;
      this.repaintPress();
    });

    // Hover callbacks are suppressed while the checkbox is disabled.
    this.pointerEvents = new PointerEvents(
      this.container,
      props,
      () => this._disabled,
    );

    this._focusOutline = new FocusOutline({
      container: this.container,
      box: () => layoutBox(this.yogaNode),
    });
    this._focusOutline.set(props);

    this._focus = new FocusState(this, props, {
      focusableByDefault: true,
      isDisabled: () => this._disabled,
      paint: (focused) => {
        this._focused = focused;
        this._focusOutline.setFocused(focused);
      },
      setPressed: (pressed) => {
        this._focusPressed = pressed;
        this.repaintPress();
      },
      activate: () => this.activate(),
    });

    if (props.disabled) this.setDisabled(true);

    if (props.visible === false) {
      this.container.visible = false;
      this.yogaNode.setDisplay(Display.None);
    }
  }

  /**
   * Toggle the box and fire `onChange`. The click path and the focus scope's
   * confirm both come through here. `update({ checked })` sets the value
   * silently.
   */
  activate(): void {
    if (this._disabled) return;
    this._checked = !this._checked;
    this.drawCheckmark();
    if (this.onChange) {
      runUICallback(this.container, "UI onChange", () =>
        this.onChange?.(this._checked),
      );
    }
  }

  /** Follow the box layout gave this row, which is what the outline rings. */
  applyLayout(): void {
    this._focusOutline.refresh();
  }

  /** Darken the box while either device holds the row down. */
  private repaintPress(): void {
    const pressed = this._pointerPressed || this._focusPressed;
    if (pressed === this._isPressed) return;
    this._isPressed = pressed;
    this.drawBox();
  }

  get visible(): boolean {
    return this.container.visible;
  }

  set visible(v: boolean) {
    this.container.visible = v;
    this.yogaNode.setDisplay(v ? Display.Flex : Display.None);
  }

  get checked(): boolean {
    return this._checked;
  }

  /** Whether the checkbox refuses the pointer and a confirm press. */
  get disabled(): boolean {
    return this._disabled;
  }

  /** Whether the checkbox holds focus in the scope that owns it. */
  get focused(): boolean {
    return this._focused;
  }

  /** Whether the checkbox takes part in focus navigation. */
  get focusable(): boolean {
    return this._focus.focusable;
  }

  setDisabled(v: boolean): void {
    this._disabled = v;
    // A disabled row ends both presses, so neither springs back when it is
    // enabled again.
    if (v) {
      this._pressStartedHere = false;
      this._pointerPressed = false;
      this._focusPressed = false;
      this.repaintPress();
    }
    this.container.eventMode = v ? "none" : "static";
    this.container.cursor = v ? "default" : "pointer";
    this.container.alpha = v ? 0.5 : 1;
  }

  update(p: Partial<UICheckboxProps>): void {
    if ("checked" in p) {
      const checked = p.checked ?? false;
      if (checked !== this._checked) {
        this._checked = checked;
        this.drawCheckmark();
      }
    }
    if ("onChange" in p) this.onChange = p.onChange;
    this.pointerEvents.set(p);
    this._focus.set(p);
    this._focusOutline.set(p);
    if ("disabled" in p) this.setDisabled(p.disabled ?? false);
    if ("consumeInput" in p) applyConsumeInput(this.container, p.consumeInput);

    if ("size" in p) {
      const size = p.size ?? DEFAULT_SIZE;
      if (size !== this._size) {
        this._size = size;
        this.drawBox();
        this.drawCheckmark();
        this.positionLabel();
        this.yogaNode.markDirty();
      }
    }

    if ("boxColor" in p) {
      this.boxColor = p.boxColor ?? DEFAULT_BOX_COLOR;
      this.drawBox();
    }
    if ("checkColor" in p) {
      this.checkColor = p.checkColor ?? DEFAULT_CHECK_COLOR;
      this.drawCheckmark();
    }

    // Removing `label` tears down the label element rather than leaving a
    // stale one — the presence check distinguishes "not passed this update"
    // (absent key, label untouched) from "explicitly removed" (present,
    // undefined).
    if ("label" in p) {
      if (p.label !== undefined) {
        if (this.label) {
          this.label.text = p.label;
          this.positionLabel();
        } else {
          this.createLabel(p.label, p.labelStyle);
        }
      } else if (this.label) {
        this.label.destroy();
        this.label = undefined;
      }
      this.yogaNode.markDirty();
    }

    if ("labelStyle" in p && this.label) {
      this.label.style =
        buildTextOptions(
          this.label.text,
          p.labelStyle,
          false,
          undefined,
          getUIDefaultTextStyle(),
        ).options.style ?? {};
      this.positionLabel();
      this.yogaNode.markDirty();
    }

    applyLayoutProps(this.yogaNode, p);

    if ("visible" in p) {
      this.visible = p.visible ?? true;
    }
  }

  /** @internal */
  _inspectState(): {
    focused: boolean;
    focusable: boolean;
    pressed: boolean;
    checked: boolean;
    disabled: boolean;
  } {
    return {
      focused: this._focused,
      focusable: this._focus.focusable,
      pressed: this._isPressed,
      checked: this._checked,
      disabled: this._disabled,
    };
  }

  /** Idempotent — a second call is a no-op. */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._focus.destroy();
    this._focusOutline.destroy();
    clearConsumeInput(this.container);
    this.yogaNode.free();
    this.box.destroy();
    this.checkmark.destroy();
    this.label?.destroy();
    this.container.destroy();
  }

  private createLabel(
    text: string,
    style?: UICheckboxProps["labelStyle"],
  ): void {
    const { options } = buildTextOptions(
      text,
      style,
      false,
      undefined,
      getUIDefaultTextStyle(),
    );
    this.label = new Text(options);
    this.positionLabel();
    this.container.addChild(this.label);
  }

  private positionLabel(): void {
    if (!this.label) return;
    this.label.position.set(
      this._size + LABEL_GAP,
      (this._size - this.label.height) / 2,
    );
  }

  /**
   * The box, in the caller's `boxColor`, darkened by the shared press factor
   * while the row is held down. The box colour does not show focus.
   */
  private drawBox(): void {
    const color = this._isPressed
      ? scaleChannels(this.boxColor, PRESS_FACTOR)
      : this.boxColor;
    this.box.clear();
    this.box.roundRect(0, 0, this._size, this._size, 3);
    this.box.fill({ color, alpha: 1 });
  }

  private drawCheckmark(): void {
    this.checkmark.clear();
    if (!this._checked) return;

    const s = this._size;
    const pad = s * 0.2;

    // Two-line checkmark path
    this.checkmark.moveTo(pad, s * 0.5);
    this.checkmark.lineTo(s * 0.4, s - pad);
    this.checkmark.lineTo(s - pad, pad);
    this.checkmark.stroke({
      color: this.checkColor,
      width: Math.max(2, s * 0.12),
    });
  }
}
