/**
 * TexturedBubble — opt-in nine-slice variant of {@link BubbleChrome}.
 *
 * Drop-in for the default Graphics bubble in a bubble {@link DialogueBundle}: it
 * implements the same {@link ChromePresenter} contract and follows the speaking
 * actor's head anchor every frame, but paints the bubble with a stretchable
 * nine-slice sprite instead of a drawn rounded rect. Any tail/pointer is
 * expected to be baked into the source texture's bottom edge.
 *
 * Use this when a theme supplies a `theme.textured.bubbleTexture`. The
 * nine-slice sprite is parented into the world layer via a host
 * {@link GraphicsComponent} (Pixi Graphics is a Container), reusing the exact
 * layer-resolution path of the Graphics bubble — no new DI surface.
 *
 * Implemented with `@yagejs/renderer`'s `createNineSlice` primitive — no direct
 * `pixi.js` import and no `@yagejs/ui` dependency.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import {
  createNineSlice,
  GraphicsComponent,
  TextComponent,
  type NineSliceSprite,
  type TextComponentOptions,
  type TextStyle,
  type TextureInput,
} from "@yagejs/renderer";

import { actorRegistryFor, type DialogueActor } from "../actor/index.js";
import type { PresentedLine } from "../core/session.js";
import type { ChromePresenter } from "./DialogueUiAdapter.js";
import type { NineSliceInsets } from "../factory/theme.js";

export interface TexturedBubbleConfig {
  /** World-space render layer. */
  readonly layer: string;
  readonly width: number;
  readonly height: number;
  readonly padding: number;
  /** Gap between the actor's head anchor and the bubble's bottom edge. */
  readonly offsetY: number;
  /** Nine-slice texture (string key or Texture) for the bubble. */
  readonly bubbleTexture: TextureInput;
  /** Border insets for the nine-slice, in source-texture pixels. */
  readonly insets: NineSliceInsets;
  readonly nameColor: number;
  readonly nameSize: number;
  readonly indicatorColor: number;
  readonly bitmapFont?: string;
  readonly fontFamily?: string;
  readonly resolution?: number;
}

export class TexturedBubble implements ChromePresenter {
  // Fields use explicit `| undefined` (not `?`) so they stay clean under the
  // repo's `useDefineForClassFields` + `exactOptionalPropertyTypes`.
  private scene: Scene | undefined;
  private root: Entity | undefined;
  private host: GraphicsComponent | undefined;
  private nineSlice: NineSliceSprite | undefined;
  private transform: Transform | undefined;
  private name: TextComponent | undefined;
  private caret: GraphicsComponent | undefined;
  private caretTransform: Transform | undefined;
  private actor: DialogueActor | undefined;
  private caretVisible = false;
  private caretTime = 0;

  constructor(private readonly cfg: TexturedBubbleConfig) {}

  mount(scene: Scene): void {
    this.scene = scene;
    const c = this.cfg;
    const root = scene.spawn("dlg-bubble");
    this.transform = root.add(new Transform());
    this.host = root.add(new GraphicsComponent({ layer: c.layer }));
    // Nine-slice anchored so its bottom edge sits `offsetY` above the actor.
    this.nineSlice = createNineSlice({
      texture: c.bubbleTexture,
      leftWidth: c.insets.left,
      topHeight: c.insets.top,
      rightWidth: c.insets.right,
      bottomHeight: c.insets.bottom,
      width: c.width,
      height: c.height,
    });
    this.nineSlice.position.set(-c.width / 2, -(c.offsetY + c.height));
    this.host.graphics.addChild(this.nineSlice);
    this.host.graphics.visible = false;

    const nameEntity = scene.spawn("dlg-bubble-name");
    nameEntity.add(new Transform()).setPosition(0, 0);
    this.name = nameEntity.add(
      new TextComponent(this.textOptions("", c.nameSize, c.nameColor)),
    );
    this.name.text.visible = false;

    const caretEntity = scene.spawn("dlg-bubble-caret");
    this.caretTransform = caretEntity.add(new Transform());
    this.caret = caretEntity.add(new GraphicsComponent({ layer: c.layer }));
    this.caret.draw((g) => {
      g.poly([0, 0, 7, 0, 3.5, 5]).fill({ color: c.indicatorColor, alpha: 1 });
    });
    this.caret.graphics.visible = false;

    this.root = root;
  }

  present(line: PresentedLine | undefined): void {
    this.actor = this.scene
      ? actorRegistryFor(this.scene).resolve(line?.speaker?.id)
      : undefined;
    const show = this.actor !== undefined;
    if (this.host) this.host.graphics.visible = show;
    if (this.name) {
      const label = line?.speaker?.name;
      this.name.text.visible = show && !!label;
      if (label) {
        this.name.text.style.fill = line?.speaker?.color ?? this.cfg.nameColor;
        this.name.setText(label);
      }
    }
    this.follow();
  }

  setNameplate(name: string | undefined): void {
    if (name === undefined) {
      this.actor = undefined;
      if (this.host) this.host.graphics.visible = false;
      if (this.name) this.name.text.visible = false;
      this.setContinueVisible(false);
    }
  }

  setContinueVisible(visible: boolean): void {
    this.caretVisible = visible && this.actor !== undefined;
    if (this.caret) this.caret.graphics.visible = this.caretVisible;
    this.caretTime = 0;
  }

  setVisible(visible: boolean): void {
    if (visible) return; // shown on the next `present`
    this.actor = undefined;
    if (this.host) this.host.graphics.visible = false;
    if (this.name) this.name.text.visible = false;
    this.setContinueVisible(false);
  }

  update(dt: number): void {
    this.follow();
    if (this.caret && this.caretVisible) {
      this.caretTime += dt;
      this.caret.graphics.alpha =
        0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.caretTime / 260));
    }
  }

  dispose(): void {
    this.root?.destroy();
    this.name?.entity.destroy();
    this.caret?.entity.destroy();
    this.root = undefined;
    this.host = undefined;
    this.nineSlice = undefined;
    this.transform = undefined;
    this.name = undefined;
    this.caret = undefined;
    this.caretTransform = undefined;
  }

  private follow(): void {
    if (!this.actor) return;
    const a = this.actor.anchorWorld();
    const c = this.cfg;
    this.transform?.setPosition(a.x, a.y);
    this.name?.entity
      .tryGet(Transform)
      ?.setPosition(
        a.x - c.width / 2 + c.padding,
        a.y - (c.offsetY + c.height) - c.nameSize - 1,
      );
    this.caretTransform?.setPosition(
      a.x + c.width / 2 - c.padding - 7,
      a.y - c.offsetY - c.padding - 2,
    );
  }

  private styleFor(size: number, color: number): TextStyle {
    const style: TextStyle = { fontSize: size, fill: color };
    if (this.cfg.fontFamily) style.fontFamily = this.cfg.fontFamily;
    return style;
  }

  private textOptions(
    text: string,
    size: number,
    color: number,
  ): TextComponentOptions {
    const style = this.styleFor(size, color);
    if (this.cfg.bitmapFont) style.fontFamily = this.cfg.bitmapFont;
    const base = { text, style, layer: this.cfg.layer, anchor: { x: 0, y: 0 } };
    // Conditionally include the optional fields so we never assign `undefined`
    // to a `?`-optional property (exactOptionalPropertyTypes).
    if (this.cfg.bitmapFont) return { ...base, bitmap: true };
    if (this.cfg.resolution !== undefined) {
      return { ...base, resolution: this.cfg.resolution };
    }
    return base;
  }
}
