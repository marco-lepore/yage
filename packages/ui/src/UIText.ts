import { Text } from "pixi.js";
import type { TextStyleOptions, Container } from "pixi.js";
import type { Node as YogaNode } from "yoga-layout";
import { MeasureMode } from "yoga-layout";
import { Display } from "yoga-layout";
import type { UIElement, UITextProps } from "./types.js";
import { createYogaNode, applyLayoutProps } from "./yoga-helpers.js";

/** Lightweight wrapper around a PixiJS Text for use in UI panels. */
export class UIText implements UIElement {
  readonly displayObject: Container;
  readonly yogaNode: YogaNode;
  private readonly text: Text;

  constructor(content: string, style?: Partial<TextStyleOptions>);
  constructor(props: UITextProps);
  constructor(
    contentOrProps: string | UITextProps,
    style?: Partial<TextStyleOptions>,
  ) {
    this.yogaNode = createYogaNode();

    if (typeof contentOrProps === "string") {
      // Legacy constructor: (content, style?)
      this.text = style
        ? new Text({ text: contentOrProps, style })
        : new Text({ text: contentOrProps });
    } else {
      // Props-driven constructor
      const props = contentOrProps;
      const s = props.style ?? {};
      this.text = new Text({ text: props.children ?? "", style: s });
      applyLayoutProps(this.yogaNode, props);

      if (props.visible === false) {
        this.text.visible = false;
      }
    }

    this.displayObject = this.text;

    // Yoga measure function — returns PixiJS text metrics
    const textRef = this.text;
    this.yogaNode.setMeasureFunc(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      (width, widthMode, _height, _heightMode) => {
        const w = textRef.width;
        const h = textRef.height;

        let measuredWidth = w;
        if (widthMode === MeasureMode.Exactly) {
          measuredWidth = width;
        } else if (widthMode === MeasureMode.AtMost) {
          measuredWidth = Math.min(w, width);
        }

        return { width: measuredWidth, height: h };
      },
    );
  }

  setText(s?: string): void {
    this.text.text = s ?? "";
    this.yogaNode.markDirty();
  }

  setStyle(s: Partial<TextStyleOptions>): void {
    console.log(this.text.style, s);
    this.text.style = s;
    this.yogaNode.markDirty();
  }

  get visible(): boolean {
    return this.displayObject.visible;
  }

  set visible(v: boolean) {
    this.displayObject.visible = v;
    this.yogaNode.setDisplay(v ? Display.Flex : Display.None);
  }

  update(props: Record<string, unknown>): void {
    console.log(props);
    const p = props as UITextProps;
    const textContent = p.children;
    if (textContent !== this.text.text) {
      this.setText(textContent);
    }
    if (p.style) {
      this.setStyle(p.style);
    }
    applyLayoutProps(this.yogaNode, p);

    if (p.visible === false) {
      this.displayObject.visible = false;
    } else if (p.visible === true) {
      this.displayObject.visible = true;
    }
  }

  destroy(): void {
    this.yogaNode.free();
    this.text.destroy();
  }
}
