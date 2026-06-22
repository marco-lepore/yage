/**
 * Default chrome — draws the dialogue box frame, the name plate, and the
 * blinking "continue" caret with the renderer (Graphics + Text on screen-space
 * layers), so this addon needs only renderer + core, not ui-react. The choice
 * list lives in its own {@link ChoiceListPresenter}; the body text lives in
 * {@link DialogueTextView}. This class owns only the frame + nameplate + caret,
 * which makes z-order deterministic and the seams swappable independently.
 *
 * The frame renders one of three ways per line, chosen by the line's
 * `meta.chrome` key (box only):
 *   - a named {@link NineSliceFrame} from {@link DialogueChromeConfig.frameStyles}
 *     (a stretchable textured frame), or
 *   - the built-in `"none"` style — no frame at all (full-bleed line), or
 *   - the drawn Graphics rounded rect (the default when there is no textured
 *     `"default"` style and the line names none / an unknown one).
 * With no `frameStyles` configured, it's always the Graphics frame.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import {
  createNineSlice,
  GraphicsComponent,
  TextComponent,
  type NineSliceSprite,
} from "@yagejs/renderer";
import { caretAlpha, drawCaret } from "./caret.js";
import type { ChromePresenter, DiagnosticSink } from "./DialogueUiAdapter.js";
import { makeTextOptions, type FontConfig } from "./textOptions.js";
import {
  CHROME_STYLE_DEFAULT,
  CHROME_STYLE_NONE,
  DEFAULT_CARET_SIZE,
  type CaretTheme,
  type NineSliceFrame,
} from "../factory/theme.js";
import type { PresentedLine } from "../core/session.js";

export interface DialogueChromeConfig extends FontConfig {
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly padding: number;
  readonly frameColor: number;
  readonly frameAlpha: number;
  readonly borderColor: number;
  readonly cornerRadius: number;
  readonly nameColor: number;
  readonly nameSize: number;
  readonly indicatorColor: number;
  /** Continue-caret blink + size (built-in defaults when omitted). */
  readonly caret?: CaretTheme | undefined;
  /** Named nine-slice box-frame styles, keyed to match `meta.chrome`. The
   *  reserved `"default"` entry is the no-meta look; `"none"` is built-in and
   *  needs no entry. Omit the whole field for the Graphics-only default. */
  readonly frameStyles?: Readonly<Record<string, NineSliceFrame>> | undefined;
  /** Frame + continue indicator. */
  readonly layerFrame: string;
  /** Name plate (drawn above the frame layer). */
  readonly layerText: string;
}

/** Which frame the active line draws: the Graphics rect, a named nine-slice, or
 *  nothing. */
export type ActiveFrame =
  | { readonly kind: "graphics" }
  | { readonly kind: "nineSlice"; readonly key: string }
  | { readonly kind: "none" };

/**
 * Resolve a line's `meta.chrome` key against the configured textured styles.
 * `"none"` → no frame; a known style → that nine-slice; missing or unknown →
 * the `"default"` textured style if present, else the drawn Graphics rect. Pure
 * so the policy is unit-testable without the renderer.
 */
export function resolveActiveFrame(
  styleKey: string | undefined,
  styles: ReadonlyMap<string, unknown>,
): ActiveFrame {
  if (styleKey === CHROME_STYLE_NONE) return { kind: "none" };
  if (styleKey !== undefined && styles.has(styleKey)) return { kind: "nineSlice", key: styleKey };
  if (styles.has(CHROME_STYLE_DEFAULT)) return { kind: "nineSlice", key: CHROME_STYLE_DEFAULT };
  return { kind: "graphics" };
}

export class DialogueChrome implements ChromePresenter {
  private frame?: Entity | undefined;
  private frameGfx?: GraphicsComponent | undefined;
  /** Separate entity hosting the nine-slice sprites (one per textured style);
   *  only spawned when {@link DialogueChromeConfig.frameStyles} has entries. Its
   *  Transform sits at the box origin so the sprites draw at local (0,0). */
  private frameTex?: Entity | undefined;
  private nineSliceHost?: GraphicsComponent | undefined;
  private readonly nineSlices = new Map<string, NineSliceSprite>();
  private name?: { entity: Entity; comp: TextComponent } | undefined;
  private indicator?: { entity: Entity; gfx: GraphicsComponent } | undefined;
  private indicatorTime = 0;
  /** Selected textured-style name from the line's `meta.chrome`, or undefined
   *  when the line names none. */
  private styleKey: string | undefined;
  private warn?: DiagnosticSink | undefined;
  private readonly warnedKeys = new Set<string>();
  /** Master gate (from {@link setVisible}); the Session drives it. Hidden at
   *  mount until a line shows. The name/caret also need their own content
   *  sub-state — each renders only when shown AND its content is present. */
  private visible = false;
  private nameShown = false;
  private caretShown = false;

  constructor(private readonly cfg: DialogueChromeConfig) {}

  /** Route the unknown-`meta.chrome` warning to the engine Logger. */
  setDiagnostics(warn: DiagnosticSink): void {
    this.warn = warn;
  }

  mount(scene: Scene): void {
    const { box, cfg } = { box: this.cfg.box, cfg: this.cfg };

    // Frame: the drawn Graphics rounded rect (the default look).
    const frame = scene.spawn("dlg-frame");
    frame.add(new Transform()).setPosition(0, 0);
    this.frameGfx = frame.add(new GraphicsComponent({ layer: cfg.layerFrame }));
    this.frameGfx.draw((g) => {
      g.roundRect(box.x, box.y, box.width, box.height, cfg.cornerRadius)
        .fill({ color: cfg.frameColor, alpha: cfg.frameAlpha })
        .stroke({ color: cfg.borderColor, alpha: 1, width: 2 });
    });
    // Hidden at mount (the Session shows it via setVisible when a line arrives),
    // so a box-only bundle doesn't show an empty frame from scene start.
    this.frameGfx.graphics.visible = false;
    this.frame = frame;

    // Textured frame styles: a nine-slice sprite per named style, parented into
    // a host GraphicsComponent (Pixi Graphics is a Container) on its OWN entity
    // — the DisplaySystem drives a GraphicsComponent's position from its entity
    // Transform, so the host needs a Transform at the box origin and its sprites
    // draw at local (0,0). Reuses renderer's layer path; no pixi.js import.
    const styles = cfg.frameStyles;
    if (styles && Object.keys(styles).length > 0) {
      const texEntity = scene.spawn("dlg-frame-tex");
      texEntity.add(new Transform()).setPosition(box.x, box.y);
      const host = texEntity.add(new GraphicsComponent({ layer: cfg.layerFrame }));
      for (const [key, spec] of Object.entries(styles)) {
        const sprite = createNineSlice({
          texture: spec.texture,
          leftWidth: spec.insets.left,
          topHeight: spec.insets.top,
          rightWidth: spec.insets.right,
          bottomHeight: spec.insets.bottom,
          width: box.width,
          height: box.height,
        });
        sprite.visible = false;
        host.graphics.addChild(sprite);
        this.nineSlices.set(key, sprite);
      }
      this.frameTex = texEntity;
      this.nineSliceHost = host;
    }

    // Name plate.
    const nameEntity = scene.spawn("dlg-name");
    nameEntity.add(new Transform()).setPosition(box.x + cfg.padding, box.y + cfg.padding - 1);
    const nameComp = nameEntity.add(
      new TextComponent(makeTextOptions(cfg, "", cfg.nameSize, cfg.nameColor, cfg.layerText)),
    );
    this.name = { entity: nameEntity, comp: nameComp };

    // Continue indicator (blinking caret at bottom-right), sized by the theme.
    const caretSize = cfg.caret?.size ?? DEFAULT_CARET_SIZE;
    const ind = scene.spawn("dlg-indicator");
    ind
      .add(new Transform())
      .setPosition(
        box.x + box.width - cfg.padding - caretSize.width,
        box.y + box.height - cfg.padding - caretSize.height - 1,
      );
    const indGfx = ind.add(new GraphicsComponent({ layer: cfg.layerFrame }));
    indGfx.draw((g) => drawCaret(g, cfg.indicatorColor, caretSize));
    indGfx.graphics.visible = false;
    this.indicator = { entity: ind, gfx: indGfx };
  }

  setNameplate(name: string | undefined, color?: number): void {
    if (!this.name) return;
    // `undefined` means "no name" — only the nameplate text, NOT a covert
    // hide-all (that overload died; the Session hides via setVisible).
    this.nameShown = name !== undefined;
    if (name !== undefined) {
      // Mutate fill in place — replacing the whole style would drop the bitmap
      // font (BitmapText resolves its font from style.fontFamily).
      this.name.comp.text.style.fill = color ?? this.cfg.nameColor;
      this.name.comp.setText(name);
    }
    this.apply();
  }

  setContinueVisible(visible: boolean): void {
    this.caretShown = visible;
    this.indicatorTime = 0;
    this.apply();
  }

  /** Pick this line's frame style from its `meta.chrome` key. Box only; the
   *  bubble ignores it. `undefined` (no line) resets to the default look. */
  present(line: PresentedLine | undefined): void {
    const metaChrome = line?.meta?.["chrome"];
    this.styleKey = typeof metaChrome === "string" ? metaChrome : undefined;
    // Warn once on a named-but-unresolvable style (a typo'd `#chrome:` lands
    // here and silently falls back, which is easy to miss).
    if (
      this.styleKey !== undefined &&
      this.styleKey !== CHROME_STYLE_NONE &&
      this.nineSlices.get(this.styleKey) === undefined &&
      !this.warnedKeys.has(this.styleKey)
    ) {
      this.warnedKeys.add(this.styleKey);
      this.warn?.(`unknown meta.chrome style "${this.styleKey}" — using the default frame`);
    }
    this.apply();
  }

  /** Show or hide the whole box. State-preserving — the name/caret content
   *  sub-state survives, so showing again restores exactly what was up. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.apply();
  }

  /** Render each piece = master-visible AND its own content present. */
  private apply(): void {
    const active = resolveActiveFrame(this.styleKey, this.nineSlices);
    if (this.frameGfx) {
      this.frameGfx.graphics.visible = this.visible && active.kind === "graphics";
    }
    if (this.nineSliceHost) {
      // The host shows only while a nine-slice is the active frame (so the
      // "graphics"/"none" cases leave nothing textured on screen).
      this.nineSliceHost.graphics.visible = this.visible && active.kind === "nineSlice";
      for (const [key, sprite] of this.nineSlices) {
        sprite.visible = active.kind === "nineSlice" && active.key === key;
      }
    }
    if (this.name) this.name.comp.text.visible = this.visible && this.nameShown;
    if (this.indicator) {
      this.indicator.gfx.graphics.visible = this.visible && this.caretShown;
    }
  }

  update(dt: number): void {
    // Read pixi's `visible` directly — a parallel boolean could desync (e.g.
    // keep animating a caret that `setVisible(false)` hid).
    const gfx = this.indicator?.gfx.graphics;
    if (gfx?.visible) {
      this.indicatorTime += dt;
      gfx.alpha = caretAlpha(this.indicatorTime, this.cfg.caret?.blinkMs);
    }
  }

  dispose(): void {
    this.frame?.destroy();
    this.frameTex?.destroy();
    this.name?.entity.destroy();
    this.indicator?.entity.destroy();
    this.nineSlices.clear();
    this.frame = undefined;
    this.frameTex = undefined;
    this.frameGfx = undefined;
    this.nineSliceHost = undefined;
    this.name = undefined;
    this.indicator = undefined;
  }
}
