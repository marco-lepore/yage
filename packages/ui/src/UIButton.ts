import { Container, Text } from "pixi.js";
import type { Node as YogaNode } from "yoga-layout";
import { Display } from "yoga-layout";
import type { BackgroundOptions, UIElement, UIButtonOptions, UIButtonProps } from "./types.js";
import { createYogaNode, applyLayoutProps } from "./yoga-helpers.js";
import { BackgroundRenderer } from "./background-renderer.js";

import { type ColorBackground, isTextureBackground } from "./types.js";

/** Default background colors for button states. */
const DEFAULT_BG: ColorBackground = { color: 0x444444, alpha: 1, radius: 4 };
const DEFAULT_HOVER_BG: ColorBackground = { color: 0x555555, alpha: 1, radius: 4 };
const DEFAULT_PRESS_BG: ColorBackground = { color: 0x333333, alpha: 1, radius: 4 };

/** Merge background options: use as-is for texture backgrounds, spread defaults for color. */
function mergeBg(def: ColorBackground, override?: BackgroundOptions): BackgroundOptions {
  if (!override) return def;
  if (isTextureBackground(override)) return override;
  return { ...def, ...override };
}

/** Lightweight interactive button for UI panels. */
export class UIButton implements UIElement {
  readonly container: Container;
  readonly yogaNode: YogaNode;

  get displayObject(): Container {
    return this.container;
  }

  private bgRenderer: BackgroundRenderer;
  private label: Text;
  private _disabled = false;
  private _width: number;
  private _height: number;
  private bgOpts: BackgroundOptions;
  private hoverBgOpts: BackgroundOptions;
  private pressBgOpts: BackgroundOptions;
  private onClick: (() => void) | undefined;

  constructor(text: string, opts: UIButtonOptions);
  constructor(props: UIButtonProps);
  constructor(
    textOrProps: string | UIButtonProps,
    opts?: UIButtonOptions,
  ) {
    this.yogaNode = createYogaNode();

    if (typeof textOrProps === "string") {
      // Legacy constructor: (text, opts)
      const o = opts!;
      this._width = o.width;
      this._height = o.height;
      this.onClick = o.onClick;
      this.bgOpts = mergeBg(DEFAULT_BG, o.background);
      this.hoverBgOpts = mergeBg(DEFAULT_HOVER_BG, o.hoverBackground);
      this.pressBgOpts = mergeBg(DEFAULT_PRESS_BG, o.pressBackground);

      this.container = new Container();
      this.container.eventMode = "static";
      this.container.cursor = "pointer";

      this.bgRenderer = new BackgroundRenderer();
      this.bgRenderer.set(this.bgOpts, this.container, 0);
      this.bgRenderer.resize(this._width, this._height);

      this.label = new Text({
        text: textOrProps,
        style: { fontSize: 14, fill: 0xffffff, ...o.textStyle },
      });
      this.label.anchor.set(0.5, 0.5);
      this.label.position.set(this._width / 2, this._height / 2);
      this.container.addChild(this.label);

      // Set fixed size on Yoga node
      this.yogaNode.setWidth(this._width);
      this.yogaNode.setHeight(this._height);

      if (o.disabled) this.setDisabled(true);
    } else {
      // Props-driven constructor
      const p = textOrProps;
      this._width = typeof p.width === "number" ? p.width : 100;
      this._height = typeof p.height === "number" ? p.height : 40;
      this.onClick = p.onClick;
      this.bgOpts = mergeBg(DEFAULT_BG, p.background);
      this.hoverBgOpts = mergeBg(DEFAULT_HOVER_BG, p.hoverBackground);
      this.pressBgOpts = mergeBg(DEFAULT_PRESS_BG, p.pressBackground);

      this.container = new Container();
      this.container.eventMode = "static";
      this.container.cursor = "pointer";

      this.bgRenderer = new BackgroundRenderer();
      this.bgRenderer.set(this.bgOpts, this.container, 0);
      this.bgRenderer.resize(this._width, this._height);

      this.label = new Text({
        text: p.children ?? "",
        style: { fontSize: 14, fill: 0xffffff, ...p.textStyle },
      });
      this.label.anchor.set(0.5, 0.5);
      this.label.position.set(this._width / 2, this._height / 2);
      this.container.addChild(this.label);

      // Apply layout props (including width/height) to Yoga node
      this.yogaNode.setWidth(this._width);
      this.yogaNode.setHeight(this._height);
      applyLayoutProps(this.yogaNode, p);

      if (p.disabled) this.setDisabled(true);
      if (p.visible === false) this.container.visible = false;
    }

    // Interaction handlers — read from mutable fields so update() changes work
    this.container.on("pointerover", () => {
      if (!this._disabled) this.applyBg(this.hoverBgOpts);
    });
    this.container.on("pointerout", () => {
      if (!this._disabled) this.applyBg(this.bgOpts);
    });
    this.container.on("pointerdown", () => {
      if (!this._disabled) this.applyBg(this.pressBgOpts);
    });
    this.container.on("pointerup", () => {
      if (this._disabled) return;
      this.applyBg(this.hoverBgOpts);
      this.onClick?.();
    });
  }

  private applyBg(opts: BackgroundOptions): void {
    this.bgRenderer.set(opts, this.container, 0);
    this.bgRenderer.resize(this._width, this._height);
  }

  setText(s: string): void {
    this.label.text = s;
  }

  setDisabled(v: boolean): void {
    this._disabled = v;
    this.container.eventMode = v ? "none" : "static";
    this.container.cursor = v ? "default" : "pointer";
    this.container.alpha = v ? 0.5 : 1;
    this.applyBg(this.bgOpts);
  }

  get disabled(): boolean {
    return this._disabled;
  }

  get visible(): boolean {
    return this.container.visible;
  }

  set visible(v: boolean) {
    this.container.visible = v;
    this.yogaNode.setDisplay(v ? Display.Flex : Display.None);
  }

  update(props: Record<string, unknown>): void {
    const p = props as UIButtonProps;

    if (p.children !== undefined) this.label.text = p.children;
    if (p.onClick !== undefined) this.onClick = p.onClick;
    if (p.disabled !== undefined) this.setDisabled(p.disabled);

    if (p.background) {
      this.bgOpts = mergeBg(DEFAULT_BG, p.background);
      if (!this._disabled) this.applyBg(this.bgOpts);
    }
    if (p.hoverBackground) {
      this.hoverBgOpts = mergeBg(DEFAULT_HOVER_BG, p.hoverBackground);
    }
    if (p.pressBackground) {
      this.pressBgOpts = mergeBg(DEFAULT_PRESS_BG, p.pressBackground);
    }

    applyLayoutProps(this.yogaNode, p);

    if (p.visible === false) {
      this.container.visible = false;
    } else if (p.visible === true) {
      this.container.visible = true;
    }
  }

  destroy(): void {
    this.yogaNode.free();
    this.bgRenderer.destroy();
    this.label.destroy();
    this.container.destroy();
  }
}
