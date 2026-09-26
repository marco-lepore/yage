import { Component, Transform } from "@yagejs/core";
import {
  GraphicsComponent,
  RendererKey,
  SceneRenderTreeKey,
  graphicsMask,
  rectMask,
} from "@yagejs/renderer";
import type {
  EffectHandle,
  RendererPlugin,
  SceneRenderTree,
} from "@yagejs/renderer";
import {
  bloom,
  outline,
  dropShadow,
  pixelate,
  glow,
  crt,
  chromaticAberration,
  vignette,
  colorGrade,
  godRay,
  shockwave,
  motionBlur,
  oldFilm,
  bulgePinch,
  halftone,
  wave,
} from "@yagejs/effects";
import type { ShockwaveHandle } from "@yagejs/effects";
import type { BlockEntity, GemEntity, HeroEntity } from "./entities.js";
import type { Toast } from "./toast.js";

/** What the toggles attach their effects to. */
interface EffectTargets {
  readonly tree: SceneRenderTree;
  readonly renderer: RendererPlugin;
  readonly block: GraphicsComponent;
  readonly gem: GraphicsComponent;
}

/**
 * Every effect the sidebar can toggle, by key, and the scope it attaches at:
 * one component, one layer, a set of layers, the scene, or the screen.
 */
const EFFECTS = {
  // ---- Component: one entity's visual ----
  outline: (t) =>
    t.block.fx.addEffect(outline({ thickness: 4, color: 0x000000 })),
  dropShadow: (t) =>
    t.block.fx.addEffect(dropShadow({ offset: { x: 8, y: 8 }, alpha: 0.7 })),
  glow: (t) => t.gem.fx.addEffect(glow({ color: 0xffff00, outerStrength: 3 })),

  // ---- Layer: the "world" layer only, so the sidebar stays crisp ----
  bloom: (t) =>
    t.tree
      .get("world")
      .fx.addEffect(bloom({ threshold: 0.3, bloomScale: 1.4 })),
  pixelate: (t) => t.tree.get("world").fx.addEffect(pixelate({ size: 6 })),
  motionBlur: (t) =>
    t.tree.get("world").fx.addEffect(motionBlur({ velocity: { x: 24, y: 0 } })),
  oldFilm: (t) =>
    t.tree.get("world").fx.addEffect(oldFilm({ sepia: 0.4, noise: 0.4 })),
  halftone: (t) =>
    t.tree.get("world").fx.addEffect(halftone({ size: 6, angle: Math.PI / 4 })),
  wave: (t) =>
    t.tree
      .get("world")
      .fx.addEffect(wave({ amplitude: 5, wavelength: 60, speed: 0.8 })),

  // ---- Layer set: one handle over a named list of layers ----
  // A world-wide grade that leaves the sidebar alone. Each listed layer costs
  // one filter pass.
  nightGrade: (t) =>
    t.tree.addLayerEffect(colorGrade({ preset: "night" }), [
      "background",
      "world",
    ]),

  // ---- Scene: the whole scene tree, sidebar included ----
  // godRay, bulgePinch and shockwave attach here rather than to the world
  // layer:
  //   - godRay's shader writes alpha=1 unconditionally, so on a
  //     partly-transparent layer it would replace the underlying
  //     background with black-tinted rays. At scene scope the composited
  //     scene is opaque; the rays read correctly over it.
  //   - bulgePinch's lens distortion has a `radius` (default 100px+) that
  //     extends past any single sprite's bbox, so layer scope clips the
  //     ring. Scene scope gives it the full canvas to work with.
  //   - shockwave's ring expands outward from `center` and likewise needs
  //     room beyond a single component's bbox to read as a ring rather
  //     than a tiny bump.
  crt: (t) => t.tree.fx.addEffect(crt({ lineContrast: 0.3 })),
  colorGrade: (t) => t.tree.fx.addEffect(colorGrade({ preset: "sepia" })),
  ca: (t) => t.tree.fx.addEffect(chromaticAberration({ separation: 4 })),
  godRay: (t) => t.tree.fx.addEffect(godRay({ angle: 25, gain: 0.5 })),
  // Center and radius are in virtual pixels, the scene's own coordinates.
  bulgePinch: (t) =>
    t.tree.fx.addEffect(
      bulgePinch({ strength: 0.6, radius: 260, center: { x: 360, y: 320 } }),
    ),
  shockwave: (t) =>
    t.tree.fx.addEffect(
      shockwave({ amplitude: 30, wavelength: 120, duration: 0.9 }),
    ),

  // ---- Screen: everything the renderer draws ----
  vignette: (t) => t.renderer.fx.addEffect(vignette({ alpha: 0.6 })),
} satisfies Record<string, (targets: EffectTargets) => EffectHandle>;

/** Key of one effect the sidebar toggles. */
export type EffectKey = keyof typeof EFFECTS;

/** The entities the controls act on, and the toast they report to. */
export interface ShowcaseParts {
  hero: HeroEntity;
  block: BlockEntity;
  gem: GemEntity;
  toast: Toast;
}

/**
 * The showcase's rules: which effects are attached, plus the masks and the
 * render flag the sidebar changes. Each toggle returns its new on/off state,
 * so the button that called it can repaint itself.
 */
export class EffectControls extends Component {
  private readonly parts: ShowcaseParts;
  private readonly handles = new Map<EffectKey, EffectHandle>();
  private targets!: EffectTargets;

  constructor(parts: ShowcaseParts) {
    super();
    this.parts = parts;
  }

  onAdd(): void {
    this.targets = {
      tree: this.use(SceneRenderTreeKey),
      renderer: this.use(RendererKey),
      block: this.parts.block.get(GraphicsComponent),
      gem: this.parts.gem.get(GraphicsComponent),
    };
  }

  /** Attach the effect when it is off, remove it when it is on. */
  toggle(key: EffectKey): boolean {
    const handle = this.handles.get(key);
    if (handle) {
      handle.remove();
      this.handles.delete(key);
      return false;
    }
    this.handles.set(key, EFFECTS[key](this.targets));
    return true;
  }

  /** Fade an attached effect in or out over `seconds`. */
  fade(key: EffectKey, direction: "in" | "out", seconds: number): void {
    const handle = this.handles.get(key);
    if (!handle) {
      this.parts.toast.show(`Toggle ${key} on first`);
      return;
    }
    if (direction === "in") handle.fadeIn(seconds);
    else handle.fadeOut(seconds);
  }

  triggerHitFlash(): void {
    this.parts.hero.flash.trigger();
  }

  /** Start a shockwave ring at the hero, once the shockwave is attached. */
  triggerShockwave(): void {
    const handle = this.handles.get("shockwave") as ShockwaveHandle | undefined;
    if (!handle) {
      this.parts.toast.show("Toggle shockwave on first");
      return;
    }
    // `trigger` takes coordinates in the effect target's local space, which
    // is virtual pixels at scene scope.
    const { x, y } = this.parts.hero.get(Transform).position;
    handle.trigger(x, y);
  }

  /** Lift the gem out of every layer- and scene-scope effect and mask. */
  toggleGemAboveEffects(): boolean {
    const gem = this.targets.gem;
    gem.renderAboveEffects = !gem.renderAboveEffects;
    return gem.renderAboveEffects;
  }

  /** Clip the gem to its top half, or remove that mask. */
  toggleGemMask(): boolean {
    const gem = this.targets.gem;
    if (gem.mask) {
      gem.clearMask();
      return false;
    }
    gem.setMask(rectMask({ x: -55, y: -55, width: 110, height: 55 }));
    return true;
  }

  /** Whether the gem's mask shows the part outside the mask instead. */
  get gemMaskInverted(): boolean {
    return this.targets.gem.mask?.inverse ?? false;
  }

  toggleGemMaskInverse(): boolean {
    const mask = this.targets.gem.mask;
    if (!mask) {
      this.parts.toast.show("Mask gem first");
      return false;
    }
    mask.setInverse(!mask.inverse);
    return mask.inverse;
  }

  /** Clip the block to a circle drawn with graphicsMask, or remove it. */
  toggleBlockMask(): boolean {
    const block = this.targets.block;
    if (block.mask) {
      block.clearMask();
      return false;
    }
    block.setMask(
      graphicsMask((mg) => {
        mg.clear();
        mg.circle(0, 0, 55);
        mg.fill({ color: 0xffffff });
      }),
    );
    return true;
  }
}
