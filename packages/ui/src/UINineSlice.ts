import { NineSliceSprite as PixiNineSliceSprite } from "pixi.js";
import type { Node as YogaNode } from "yoga-layout";
import { Display } from "yoga-layout";
import type {
  DisplayContainer,
  NineSliceSprite,
  TextureInput,
} from "@yagejs/renderer";
import { resolveTextureInput } from "@yagejs/renderer";
import type { UIElement, UINineSliceProps } from "./types.js";
import { createYogaNode, applyLayoutProps } from "./yoga-helpers.js";
import { applyConsumeInput, clearConsumeInput } from "./consume-input.js";
import { PointerEvents } from "./pointer-events.js";

/** Displays a nine-slice texture as a UI element. Requires explicit width/height from layout. */
export class UINineSlice implements UIElement {
  readonly container: NineSliceSprite;
  readonly yogaNode: YogaNode;

  get displayObject(): DisplayContainer {
    return this.container;
  }

  private textureInput: TextureInput;
  private readonly pointerEvents: PointerEvents;
  private _destroyed = false;

  constructor(props: UINineSliceProps) {
    this.yogaNode = createYogaNode();
    this.textureInput = props.texture;

    const texture = resolveTextureInput(this.textureInput);
    const insets = props.insets;

    if (typeof insets === "number") {
      this.container = new PixiNineSliceSprite({
        texture,
        leftWidth: insets,
        topHeight: insets,
        rightWidth: insets,
        bottomHeight: insets,
      });
    } else {
      this.container = new PixiNineSliceSprite({
        texture,
        leftWidth: insets.left,
        topHeight: insets.top,
        rightWidth: insets.right,
        bottomHeight: insets.bottom,
      });
    }

    applyConsumeInput(this.container, props.consumeInput);
    this.pointerEvents = new PointerEvents(this.container, props);

    if (props.tint !== undefined) this.container.tint = props.tint;
    if (props.alpha !== undefined) this.container.alpha = props.alpha;

    applyLayoutProps(this.yogaNode, props);

    if (props.visible === false) {
      this.container.visible = false;
      this.yogaNode.setDisplay(Display.None);
    }
  }

  /** Set sprite dimensions to match Yoga computed size. */
  applyLayout(): void {
    const w = this.yogaNode.getComputedWidth();
    const h = this.yogaNode.getComputedHeight();
    this.container.width = w;
    this.container.height = h;
  }

  get visible(): boolean {
    return this.container.visible;
  }

  set visible(v: boolean) {
    this.container.visible = v;
    this.yogaNode.setDisplay(v ? Display.Flex : Display.None);
  }

  update(p: Partial<UINineSliceProps>): void {
    if (p.texture !== undefined && p.texture !== this.textureInput) {
      this.textureInput = p.texture;
      this.container.texture = resolveTextureInput(p.texture);
    }

    if ("insets" in p && p.insets !== undefined) {
      const insets = p.insets;
      this.container.leftWidth =
        typeof insets === "number" ? insets : insets.left;
      this.container.topHeight =
        typeof insets === "number" ? insets : insets.top;
      this.container.rightWidth =
        typeof insets === "number" ? insets : insets.right;
      this.container.bottomHeight =
        typeof insets === "number" ? insets : insets.bottom;
    }

    if ("tint" in p) this.container.tint = p.tint ?? 0xffffff;
    if ("alpha" in p) this.container.alpha = p.alpha ?? 1;
    if ("consumeInput" in p) applyConsumeInput(this.container, p.consumeInput);
    this.pointerEvents.set(p);

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
    this.container.destroy();
  }
}
