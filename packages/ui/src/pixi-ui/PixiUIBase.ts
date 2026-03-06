import type { Container } from "pixi.js";
import type { Node as YogaNode } from "yoga-layout";
import { Display, MeasureMode } from "yoga-layout";
import type { LayoutProps, UIElement } from "../types.js";
import { createYogaNode, applyLayoutProps } from "../yoga-helpers.js";

/**
 * Abstract base class for wrapping @pixi/ui components as Yoga-aware UIElements.
 *
 * Handles: Yoga node + measure function, prevProps storage, bridgeSignal helper,
 * visible prop, applyLayout, and destroy cleanup.
 */
export abstract class PixiUIBase<T extends Container> implements UIElement {
  readonly yogaNode: YogaNode;
  protected readonly view: T;
  protected prevProps: Record<string, unknown> = {};

  get displayObject(): Container {
    return this.view;
  }

  get visible(): boolean {
    return this.view.visible;
  }

  set visible(v: boolean) {
    this.view.visible = v;
    this.yogaNode.setDisplay(v ? Display.Flex : Display.None);
  }

  constructor(view: T, props: LayoutProps) {
    this.view = view;
    this.yogaNode = createYogaNode();

    this.yogaNode.setMeasureFunc((w, wMode, h, hMode) => {
      const natW = view.width;
      const natH = view.height;

      let mW = natW;
      let mH = natH;

      if (wMode === MeasureMode.Exactly) mW = w;
      else if (wMode === MeasureMode.AtMost) mW = Math.min(natW, w);

      if (hMode === MeasureMode.Exactly) mH = h;
      else if (hMode === MeasureMode.AtMost) mH = Math.min(natH, h);

      return { width: mW, height: mH };
    });

    applyLayoutProps(this.yogaNode, props);
    if (props.visible === false) this.visible = false;
  }

  applyLayout(): void {
    this.view.width = this.yogaNode.getComputedWidth();
    this.view.height = this.yogaNode.getComputedHeight();
  }

  /** Bridge a @pixi/ui Signal to a callback prop. Only reconnects if ref changed. */
  protected bridgeSignal<F extends (...args: unknown[]) => void>(
    signal: { connect: (cb: F) => void; disconnect: (cb: F) => void },
    key: string,
    newProps: Record<string, unknown>,
  ): void {
    if (!(key in newProps)) return;
    const oldCb = this.prevProps[key] as F | undefined;
    const newCb = newProps[key] as F | undefined;
    if (newCb === oldCb) return;
    if (oldCb) signal.disconnect(oldCb);
    if (newCb) signal.connect(newCb);
  }

  /** Apply layout props, visible, and store prevProps. Call at end of subclass update(). */
  protected updateBase(props: Record<string, unknown>): void {
    applyLayoutProps(this.yogaNode, props as LayoutProps);
    if ("visible" in props) this.visible = props.visible as boolean;
    Object.assign(this.prevProps, props);
  }

  abstract update(props: Record<string, unknown>): void;

  destroy(): void {
    this.disconnectAll();
    this.yogaNode.free();
    this.view.destroy();
  }

  /** Override in subclass to disconnect all signals on destroy. */
  protected abstract disconnectAll(): void;
}
