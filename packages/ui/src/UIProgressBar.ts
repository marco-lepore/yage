import { Container } from "pixi.js";
import type { Node as YogaNode } from "yoga-layout";
import { Display } from "yoga-layout";
import type { DisplayContainer } from "@yagejs/renderer";
import type { BackgroundOptions, UIProgressBarProps } from "./types.js";
import { UIElementBase } from "./UIElementBase.js";
import { createYogaNode, applyLayoutProps } from "./yoga-helpers.js";
import { BackgroundRenderer } from "./background-renderer.js";
import { applyConsumeInput, clearConsumeInput } from "./consume-input.js";
import { PointerEvents } from "./pointer-events.js";
import { FocusOutline, layoutBox } from "./internal/focus-outline.js";
import { FocusState } from "./focus/FocusState.js";
import {
  requestHoverFocus,
  requestPressFocus,
} from "./focus/pointer-request.js";

/** Default track and fill backgrounds. */
const DEFAULT_TRACK: BackgroundOptions = { color: 0x333333, alpha: 1 };
const DEFAULT_FILL: BackgroundOptions = { color: 0x44aa44, alpha: 1 };

/** A progress bar with track and fill backgrounds. */
export class UIProgressBar extends UIElementBase {
  readonly container: DisplayContainer;
  readonly yogaNode: YogaNode;

  get displayObject(): DisplayContainer {
    return this.container;
  }

  private trackRenderer: BackgroundRenderer;
  private fillRenderer: BackgroundRenderer;
  private _value: number;
  private _direction: "horizontal" | "vertical";
  private lastWidth = 0;
  private lastHeight = 0;
  private readonly pointerEvents: PointerEvents;
  private readonly _focus: FocusState;
  private readonly _focusOutline: FocusOutline;
  private _destroyed = false;

  constructor(props: UIProgressBarProps) {
    super();
    this.yogaNode = createYogaNode();
    this.container = new Container();
    applyConsumeInput(this.container, props.consumeInput);
    this.pointerEvents = new PointerEvents(this.container, props);

    // Out of focus navigation until a game asks for it with `focusable`.
    // Asked for, the bar is outlined like every other focusable element; the
    // pointer still moves focus here, which keeps the mouse and the keyboard
    // on the same element.
    this._focusOutline = new FocusOutline({
      container: this.container,
      box: () => layoutBox(this.yogaNode),
    });
    this._focusOutline.set(props);
    this._focus = new FocusState(this, props, {
      focusableByDefault: false,
      paint: (focused) => this._focusOutline.setFocused(focused),
    });
    this.container.on("pointerover", () => {
      requestHoverFocus(this);
    });
    this.container.on("pointerdown", () => {
      requestPressFocus(this);
    });

    this._value = clamp(props.value);
    this._direction = props.direction ?? "horizontal";

    // Track (background)
    this.trackRenderer = new BackgroundRenderer();
    this.trackRenderer.set(
      props.trackBackground ?? DEFAULT_TRACK,
      this.container,
      0,
    );

    // Fill (foreground)
    this.fillRenderer = new BackgroundRenderer();
    this.fillRenderer.set(
      props.fillBackground ?? DEFAULT_FILL,
      this.container,
      1,
    );

    applyLayoutProps(this.yogaNode, props);
    this.applyTransformProps(props);

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
    this._focusOutline.refresh();
  }

  /**
   * Fill fraction, 0 to 1, as last set. Reads back what `update({ value })`
   * clamped, which is not necessarily what was passed in.
   */
  get value(): number {
    return this._value;
  }

  get visible(): boolean {
    return this.container.visible;
  }

  set visible(v: boolean) {
    this.container.visible = v;
    this.yogaNode.setDisplay(v ? Display.Flex : Display.None);
  }

  update(p: Partial<UIProgressBarProps>): void {
    if (p.value !== undefined) {
      this._value = clamp(p.value);
    }

    if ("direction" in p) {
      this._direction = p.direction ?? "horizontal";
    }

    if ("trackBackground" in p) {
      this.trackRenderer.set(
        p.trackBackground ?? DEFAULT_TRACK,
        this.container,
        0,
      );
    }

    if ("fillBackground" in p) {
      this.fillRenderer.set(
        p.fillBackground ?? DEFAULT_FILL,
        this.container,
        1,
      );
    }

    if ("consumeInput" in p) applyConsumeInput(this.container, p.consumeInput);
    this.pointerEvents.set(p);
    this._focus.set(p);
    this._focusOutline.set(p);

    applyLayoutProps(this.yogaNode, p);
    this.applyTransformProps(p);

    // Re-apply fill sizing with new value
    if (this.lastWidth > 0 || this.lastHeight > 0) {
      this.resizeFill();
    }

    if ("visible" in p) {
      this.visible = p.visible ?? true;
    }
  }

  /**
   * What the Inspector reports for this progress bar: whether it takes part in
   * focus navigation, which is off unless the game asked for it, and whether
   * it holds focus right now. A test reads this instead of a screenshot.
   * @internal
   */
  _inspectState(): { focused: boolean; focusable: boolean } {
    return { focused: this._focus.focused, focusable: this._focus.focusable };
  }

  /** Idempotent — a second call is a no-op. */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._focus.destroy();
    this._focusOutline.destroy();
    clearConsumeInput(this.container);
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
