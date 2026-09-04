import type { DisplayContainer } from "@yagejs/renderer";
import type { Node as YogaNode } from "yoga-layout";
import { Display, MeasureMode } from "yoga-layout";
import type { LayoutProps, UIElement } from "../types.js";
import { createYogaNode, applyLayoutProps } from "../yoga-helpers.js";
import { runUICallback } from "../error-boundary.js";

/**
 * Abstract base class for wrapping @pixi/ui components as Yoga-aware UIElements.
 *
 * Handles: Yoga node + measure function, prevProps storage, bridgeSignal helper,
 * visible prop, applyLayout, and destroy cleanup.
 */
export abstract class PixiUIBase<
  T extends DisplayContainer,
> implements UIElement {
  readonly yogaNode: YogaNode;
  protected readonly view: T;
  protected prevProps: Record<string, unknown> = {};
  private readonly bridgedCallbacks = new Map<
    string,
    Map<(...args: never[]) => void, (...args: never[]) => void>
  >();
  private _destroyed = false;

  get displayObject(): DisplayContainer {
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
    kind: string,
    newProps: Record<string, unknown>,
  ): void {
    if (!(key in newProps)) return;
    const oldCb = this.prevProps[key] as F | undefined;
    const newCb = newProps[key] as F | undefined;
    if (newCb === oldCb) return;
    if (oldCb) {
      const callbacks = this.bridgedCallbacks.get(key);
      const oldWrapped = callbacks?.get(oldCb as (...args: never[]) => void) as
        | F
        | undefined;
      signal.disconnect(oldWrapped ?? oldCb);
      callbacks?.delete(oldCb as (...args: never[]) => void);
      if (callbacks?.size === 0) this.bridgedCallbacks.delete(key);
    }
    if (newCb) {
      const wrapped = ((...args: Parameters<F>) => {
        runUICallback(this.view, kind, () => newCb(...args));
      }) as F;
      let callbacks = this.bridgedCallbacks.get(key);
      if (!callbacks) {
        callbacks = new Map();
        this.bridgedCallbacks.set(key, callbacks);
      }
      callbacks.set(
        newCb as (...args: never[]) => void,
        wrapped as (...args: never[]) => void,
      );
      signal.connect(wrapped);
    }
  }

  protected disconnectBridgedSignal<F extends (...args: unknown[]) => void>(
    signal: { disconnect: (cb: F) => void },
    key: string,
  ): void {
    const callback = this.prevProps[key] as F | undefined;
    if (!callback) return;
    const callbacks = this.bridgedCallbacks.get(key);
    const wrapped = callbacks?.get(callback as (...args: never[]) => void) as
      | F
      | undefined;
    signal.disconnect(wrapped ?? callback);
    callbacks?.delete(callback as (...args: never[]) => void);
    if (callbacks?.size === 0) this.bridgedCallbacks.delete(key);
  }

  /** Apply layout props, visible, and store prevProps. Call at end of subclass update(). */
  protected updateBase(props: Record<string, unknown>): void {
    applyLayoutProps(this.yogaNode, props as LayoutProps);
    if ("visible" in props)
      this.visible = (props.visible as boolean | undefined) ?? true;
    Object.assign(this.prevProps, props);
  }

  abstract update(props: Record<string, unknown>): void;

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this.disconnectAll();
    this.bridgedCallbacks.clear();
    this.yogaNode.free();
    this.view.destroy();
  }

  /** Override in subclass to disconnect all signals on destroy. */
  protected abstract disconnectAll(): void;
}
