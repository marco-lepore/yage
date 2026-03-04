import { Container } from "pixi.js";
import type { Node as YogaNode } from "yoga-layout";
import { Display } from "yoga-layout";
import type { BackgroundOptions, UIElement, UIProgressBarProps } from "./types.js";
import { createYogaNode, applyLayoutProps } from "./yoga-helpers.js";
import { BackgroundRenderer } from "./background-renderer.js";

/** Default track and fill backgrounds. */
const DEFAULT_TRACK: BackgroundOptions = { color: 0x333333, alpha: 1 };
const DEFAULT_FILL: BackgroundOptions = { color: 0x44aa44, alpha: 1 };

/** A progress bar with track and fill backgrounds. */
export class UIProgressBar implements UIElement {
  readonly container: Container;
  readonly yogaNode: YogaNode;

  get displayObject(): Container {
    return this.container;
  }

  private trackRenderer: BackgroundRenderer;
  private fillRenderer: BackgroundRenderer;
  private _value: number;
  private _direction: "horizontal" | "vertical";
  private lastWidth = 0;
  private lastHeight = 0;

  constructor(props: UIProgressBarProps) {
    this.yogaNode = createYogaNode();
    this.container = new Container();

    this._value = clamp(props.value);
    this._direction = props.direction ?? "horizontal";

    // Track (background)
    this.trackRenderer = new BackgroundRenderer();
    this.trackRenderer.set(props.trackBackground ?? DEFAULT_TRACK, this.container, 0);

    // Fill (foreground)
    this.fillRenderer = new BackgroundRenderer();
    this.fillRenderer.set(props.fillBackground ?? DEFAULT_FILL, this.container, 1);

    applyLayoutProps(this.yogaNode, props);

    if (props.visible === false) {
      this.container.visible = false;
      this.yogaNode.setDisplay(Display.None);
    }
  }

  /** Size track to full computed size, fill proportionally to value. */
  applyLayout(): void {
    const w = this.yogaNode.getComputedWidth();
    const h = this.yogaNode.getComputedHeight();
    this.lastWidth = w;
    this.lastHeight = h;

    this.trackRenderer.resize(w, h);
    this.resizeFill();
  }

  get visible(): boolean {
    return this.container.visible;
  }

  set visible(v: boolean) {
    this.container.visible = v;
    this.yogaNode.setDisplay(v ? Display.Flex : Display.None);
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as UIProgressBarProps;

    if (p.value !== undefined) {
      this._value = clamp(p.value);
    }

    if (p.direction !== undefined) {
      this._direction = p.direction;
    }

    if (p.trackBackground !== undefined) {
      this.trackRenderer.set(p.trackBackground, this.container, 0);
    }

    if (p.fillBackground !== undefined) {
      this.fillRenderer.set(p.fillBackground, this.container, 1);
    }

    applyLayoutProps(this.yogaNode, p);

    // Re-apply fill sizing with new value
    if (this.lastWidth > 0 || this.lastHeight > 0) {
      this.resizeFill();
    }

    if (p.visible === false) {
      this.container.visible = false;
    } else if (p.visible === true) {
      this.container.visible = true;
    }
  }

  destroy(): void {
    this.yogaNode.free();
    this.trackRenderer.destroy();
    this.fillRenderer.destroy();
    this.container.destroy();
  }

  private resizeFill(): void {
    if (this._direction === "horizontal") {
      this.fillRenderer.resize(this.lastWidth * this._value, this.lastHeight);
    } else {
      this.fillRenderer.resize(this.lastWidth, this.lastHeight * this._value);
    }
  }
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}
