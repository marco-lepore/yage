import { Container, Graphics, Text } from "pixi.js";
import type { Node as YogaNode } from "yoga-layout";
import { Display, MeasureMode } from "yoga-layout";
import type { DisplayContainer } from "@yagejs/renderer";
import type { UIElement, UICheckboxProps } from "./types.js";
import { createYogaNode, applyLayoutProps } from "./yoga-helpers.js";
import { applyConsumeInput, clearConsumeInput } from "./consume-input.js";

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
  private _size: number;
  private boxColor: number;
  private checkColor: number;
  private onChange: ((checked: boolean) => void) | undefined;
  private _destroyed = false;

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

    // Click handler
    this.container.on("pointerup", () => {
      if (this._disabled) return;
      this._checked = !this._checked;
      this.drawCheckmark();
      this.onChange?.(this._checked);
    });

    if (props.disabled) this.setDisabled(true);

    if (props.visible === false) {
      this.container.visible = false;
      this.yogaNode.setDisplay(Display.None);
    }
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

  setDisabled(v: boolean): void {
    this._disabled = v;
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
    if ("disabled" in p) this.setDisabled(p.disabled ?? false);
    if ("consumeInput" in p) applyConsumeInput(this.container, p.consumeInput);

    if ("size" in p) {
      const size = p.size ?? DEFAULT_SIZE;
      if (size !== this._size) {
        this._size = size;
        this.drawBox();
        this.drawCheckmark();
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
      this.label.style = { fontSize: 14, fill: 0xffffff, ...p.labelStyle };
      this.yogaNode.markDirty();
    }

    applyLayoutProps(this.yogaNode, p);

    if ("visible" in p) {
      this.visible = p.visible ?? true;
    }
  }

  /** Idempotent — a second call is a no-op. */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    clearConsumeInput(this.container);
    this.yogaNode.free();
    this.box.destroy();
    this.checkmark.destroy();
    this.label?.destroy();
    this.container.destroy();
  }

  private createLabel(text: string, style?: UICheckboxProps["labelStyle"]): void {
    this.label = new Text({
      text,
      style: { fontSize: 14, fill: 0xffffff, ...style },
    });
    this.label.position.set(
      this._size + LABEL_GAP,
      (this._size - this.label.height) / 2,
    );
    this.container.addChild(this.label);
  }

  private drawBox(): void {
    this.box.clear();
    this.box.roundRect(0, 0, this._size, this._size, 3);
    this.box.fill({ color: this.boxColor, alpha: 1 });
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
    this.checkmark.stroke({ color: this.checkColor, width: Math.max(2, s * 0.12) });
  }
}
