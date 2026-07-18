/**
 * Effects showcase — exercises every preset in `@yagejs/effects` at each
 * scope (component, layer, scene, screen) and demonstrates that the state
 * survives a save/load round-trip.
 *
 * The toggle UI lives on its own screen-space `"ui"` layer, ABOVE the
 * `"world"` layer that gets bloomed/pixelated/halftoned/etc. Layer-scope
 * effects on `"world"` paint only that layer, so the UI stays crisp through
 * every world-level toggle. Scene-scope (`tree.fx`) and screen-scope
 * (`renderer.fx`) effects DO cover the UI — that's what those scopes mean,
 * and toggling crt or vignette puts the UI under the same treatment.
 *
 * Geometry is procedural (`GraphicsComponent.draw`) and the engine doesn't
 * persist drawing commands across save/load, so each shape lives on its
 * own `@serializable` entity that re-runs its draw in `afterRestore()`.
 */

import {
  Entity,
  Engine,
  Scene,
  SceneManagerKey,
  Transform,
  Vec2,
  serializable,
} from "@yagejs/core";
import {
  RendererPlugin,
  GraphicsComponent,
  RendererKey,
  SceneRenderTreeProviderKey,
  graphicsMask,
  linearGradient,
  radialGradient,
  rectMask,
  type LayerDef,
} from "@yagejs/renderer";
import type { EffectHandle, MaskHandle } from "@yagejs/renderer";
import { SnapshotPlugin, SnapshotServiceKey } from "@yagejs/save";
import {
  UIPlugin,
  UISurface,
  UIButton,
  UIPanel,
  Anchor,
  type ColorBackground,
} from "@yagejs/ui";
import {
  hitFlash,
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
import type { HitFlashHandle, ShockwaveHandle } from "@yagejs/effects";
import { injectStyles, installDebugFromUrl, setupGameContainer } from "./shared.js";

const VIRTUAL_WIDTH = 900;
const VIRTUAL_HEIGHT = 640;
const SIDEBAR_WIDTH = 248;

injectStyles(`
  #toast {
    position: fixed; bottom: 2rem; left: 50%;
    transform: translateX(-50%);
    background: rgba(0,0,0,0.85); color: #22c55e;
    font-family: monospace; font-size: 0.9rem;
    padding: 0.4rem 1.2rem; border-radius: 6px;
    pointer-events: none; opacity: 0;
    transition: opacity 0.2s;
  }
  #toast.show { opacity: 1; }
`);

const toast = document.createElement("div");
toast.id = "toast";
document.body.appendChild(toast);

let toastTimer = 0;
function showToast(msg: string): void {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1500);
}

// ---------------------------------------------------------------------------
// Layer setup. The "ui" layer is screen-space and ordered above everything
// else, so it's not transformed by cameras and isn't part of the "world"
// layer's effects host. World-scope effects (bloom, halftone, etc.) attach
// to the "world" RenderLayer's container — the UI layer is a sibling, not a
// descendant, and is unaffected.
// ---------------------------------------------------------------------------
const layers: LayerDef[] = [
  { name: "background", order: -10 },
  { name: "world", order: 0 },
  { name: "ui", order: 1000, space: "screen" },
];

// Toggle button styling — color BG only, no nine-slice assets needed.
const BTN_OFF: ColorBackground = { color: 0x1f2937, alpha: 1, radius: 4 };
const BTN_OFF_HOVER: ColorBackground = { color: 0x374151, alpha: 1, radius: 4 };
const BTN_ON: ColorBackground = { color: 0x0ea5e9, alpha: 1, radius: 4 };
const BTN_ON_HOVER: ColorBackground = { color: 0x0284c7, alpha: 1, radius: 4 };
const BTN_ACCENT: ColorBackground = { color: 0x115e59, alpha: 1, radius: 4 };
const BTN_ACCENT_HOVER: ColorBackground = { color: 0x0f766e, alpha: 1, radius: 4 };

const TXT_LABEL = { fontFamily: "monospace", fontSize: 11, fill: 0xffffff };
const TXT_HEADING = {
  fontFamily: "monospace",
  fontSize: 11,
  fill: 0xfde68a,
  fontWeight: "bold" as const,
};
const TXT_TITLE = {
  fontFamily: "monospace",
  fontSize: 14,
  fill: 0xffffff,
  fontWeight: "bold" as const,
};

/** Apply on/off styling to a UIButton. Used to mark the active toggles so
 * the in-game UI mirrors the panel's HTML predecessor. */
function paintButton(btn: UIButton, on: boolean): void {
  btn.update({
    background: on ? BTN_ON : BTN_OFF,
    hoverBackground: on ? BTN_ON_HOVER : BTN_OFF_HOVER,
  });
}

/** Colourful, detailed backdrop so subtle effects stay visible. Lives on
 * the "background" layer below the world. */
@serializable
class BackgroundEntity extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(0, 0) }));
    this.add(new GraphicsComponent({ layer: "background" }));
    this.redraw();
  }

  afterRestore(): void {
    this.redraw();
  }

  private redraw(): void {
    const g = this.tryGet(GraphicsComponent);
    if (!g) return;
    g.draw((ctx) => {
      ctx.clear();
      const sky = linearGradient({
        axis: "vertical",
        stops: [
          { offset: 0, color: 0x1e1b4b },
          { offset: 0.5, color: 0x312e81 },
          { offset: 1, color: 0x065f46 },
        ],
      });
      ctx.rect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT).fill(sky);

      const sun = radialGradient({
        center: { x: 0.25, y: 0.25 },
        outerRadius: 0.7,
        stops: [
          { offset: 0, color: 0xfde68a, alpha: 0.4 },
          { offset: 1, color: 0xfde68a, alpha: 0 },
        ],
        space: "local",
      });
      ctx.rect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT).fill(sun);

      // Grid lines so pixelate / chromaticAberration / CRT / halftone /
      // wave have geometry to chew on.
      const gridStep = 40;
      for (let x = 0; x <= VIRTUAL_WIDTH; x += gridStep) {
        ctx
          .moveTo(x, 0)
          .lineTo(x, VIRTUAL_HEIGHT)
          .stroke({ color: 0xffffff, width: 1, alpha: 0.06 });
      }
      for (let y = 0; y <= VIRTUAL_HEIGHT; y += gridStep) {
        ctx
          .moveTo(0, y)
          .lineTo(VIRTUAL_WIDTH, y)
          .stroke({ color: 0xffffff, width: 1, alpha: 0.06 });
      }

      const palette = [0xfacc15, 0xf472b6, 0x60a5fa, 0x34d399, 0xfb923c];
      let seed = 1;
      const rand = (): number => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };
      for (let i = 0; i < 60; i++) {
        const x = rand() * VIRTUAL_WIDTH;
        const y = rand() * VIRTUAL_HEIGHT;
        const r = 1 + rand() * 2.5;
        const color = palette[Math.floor(rand() * palette.length)] ?? 0xffffff;
        ctx.circle(x, y, r).fill({ color, alpha: 0.65 });
      }
    });
  }
}

/** Blue circle with the demo's pre-attached hitFlash effect. */
@serializable
class HeroEntity extends Entity {
  flashHandle: HitFlashHandle | null = null;

  setup(): void {
    this.add(new Transform({ position: new Vec2(150, 320) }));
    this.add(new GraphicsComponent({ layer: "world" }));
    this.redraw();
    this.attachHitFlash();
  }

  afterRestore(): void {
    this.redraw();
    const g = this.tryGet(GraphicsComponent);
    this.flashHandle = g?.fx.findEffect(hitFlash) ?? null;
    if (!this.flashHandle) this.attachHitFlash();
  }

  private attachHitFlash(): void {
    const g = this.tryGet(GraphicsComponent);
    if (!g) return;
    this.flashHandle = g.fx.addEffect(
      hitFlash({ color: 0xffffff, duration: 0.2 }),
    );
  }

  private redraw(): void {
    const g = this.tryGet(GraphicsComponent);
    if (!g) return;
    g.draw((ctx) => {
      ctx.clear();
      ctx.circle(0, 0, 60).fill({ color: 0x38bdf8 });
      ctx.circle(0, 0, 60).stroke({ color: 0x0ea5e9, width: 4 });
    });
  }
}

/** Orange square — outline / dropShadow target. */
@serializable
class BlockEntity extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(310, 320) }));
    this.add(new GraphicsComponent({ layer: "world" }));
    this.redraw();
  }

  afterRestore(): void {
    this.redraw();
  }

  private redraw(): void {
    const g = this.tryGet(GraphicsComponent);
    if (!g) return;
    g.draw((ctx) => {
      ctx.clear();
      ctx.rect(-60, -60, 120, 120).fill({ color: 0xf97316 });
      ctx.rect(-60, -60, 120, 120).stroke({ color: 0xfb923c, width: 2 });
    });
  }
}

/** Green diamond — glow target. */
@serializable
class GemEntity extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(490, 320) }));
    this.add(new GraphicsComponent({ layer: "world" }));
    this.redraw();
  }

  afterRestore(): void {
    this.redraw();
  }

  private redraw(): void {
    const g = this.tryGet(GraphicsComponent);
    if (!g) return;
    g.draw((ctx) => {
      ctx.clear();
      ctx.poly([0, -55, 50, 0, 0, 55, -50, 0]).fill({ color: 0x22c55e });
      ctx.poly([0, -55, 50, 0, 0, 55, -50, 0]).stroke({
        color: 0x16a34a,
        width: 3,
      });
    });
  }
}

@serializable
class ShowcaseScene extends Scene {
  readonly name = "effects-showcase";
  readonly layers = layers;

  private effectHandles = new Map<string, EffectHandle | null>();
  private toggleButtons = new Map<string, UIButton>();
  private hero: HeroEntity | null = null;
  private block: BlockEntity | null = null;
  private gem: GemEntity | null = null;

  onEnter(): void {
    this.spawn(BackgroundEntity);
    this.hero = this.spawn(HeroEntity);
    this.block = this.spawn(BlockEntity);
    this.gem = this.spawn(GemEntity);

    this.buildPanel();
  }

  afterRestore(): void {
    for (const e of this.getEntities()) {
      if (e instanceof HeroEntity) this.hero = e;
      else if (e instanceof BlockEntity) this.block = e;
      else if (e instanceof GemEntity) this.gem = e;
    }

    this.effectHandles.clear();
    this.toggleButtons.clear();
    this.buildPanel();
    // Layer/scene/screen-scope effects are restored by the renderer's
    // snapshot contributor AFTER scene.afterRestore returns. doLoad calls
    // syncPanelToRestoredEffects() once the load promise resolves so the
    // sync runs against the fully-restored render trees.
  }

  /** After load, the renderer has rebuilt every saved effect at every
   * scope, but our toggle map is empty. Walk each scope for the presets we
   * expose buttons for, recover their handles, and re-paint the
   * corresponding toggle button as "on". */
  syncPanelToRestoredEffects(): void {
    const tree = this.context.resolve(SceneRenderTreeProviderKey).getTree(this);
    if (!tree) return;
    const renderer = this.context.resolve(RendererKey);
    const world = tree.tryGet("world");

    const sync = (key: string, handle: EffectHandle | null): void => {
      if (!handle) return;
      this.effectHandles.set(key, handle);
      const btn = this.toggleButtons.get(key);
      if (btn) paintButton(btn, true);
    };

    const blockGfx = this.block?.tryGet(GraphicsComponent);
    const gemGfx = this.gem?.tryGet(GraphicsComponent);

    sync("outline", blockGfx?.fx.findEffect(outline) ?? null);
    sync("dropShadow", blockGfx?.fx.findEffect(dropShadow) ?? null);
    sync("glow", gemGfx?.fx.findEffect(glow) ?? null);
    sync("bloom", world?.fx.findEffect(bloom) ?? null);
    sync("pixelate", world?.fx.findEffect(pixelate) ?? null);
    sync("motionBlur", world?.fx.findEffect(motionBlur) ?? null);
    sync("halftone", world?.fx.findEffect(halftone) ?? null);
    sync("wave", world?.fx.findEffect(wave) ?? null);
    sync("oldFilm", world?.fx.findEffect(oldFilm) ?? null);
    sync("crt", tree.fx.findEffect(crt));
    sync("colorGrade", tree.fx.findEffect(colorGrade));
    sync("ca", tree.fx.findEffect(chromaticAberration));
    // godRay, bulgePinch, shockwave live at scene scope: they overlay the
    // whole composited scene rather than a single layer. godRay's shader
    // forces alpha=1, so on a partly-transparent layer it would mask the
    // background to black; bulgePinch's distortion radius extends beyond
    // any single sprite's bbox; shockwave's ring needs the full scene to
    // expand into.
    sync("godRay", tree.fx.findEffect(godRay));
    sync("bulgePinch", tree.fx.findEffect(bulgePinch));
    sync("shockwave", tree.fx.findEffect(shockwave));
    sync("vignette", renderer.fx.findEffect(vignette));
  }

  private buildPanel(): void {
    const tree = this.context.resolve(SceneRenderTreeProviderKey).getTree(this);
    if (!tree) throw new Error("scene render tree not yet attached");
    const renderer = this.context.resolve(RendererKey);

    // The sidebar entity carries the root UISurface. We rebuild it on every
    // call (initial + afterRestore) — entities and their UI are scene-owned
    // so they're already recreated by the snapshot pipeline; we just need
    // to repopulate the toggle handle map.
    const sidebarEntity = this.spawn("effects-sidebar");
    const sidebar = sidebarEntity.add(
      new UISurface({
        layer: "ui",
        anchor: Anchor.TopRight,
        offset: { x: -8, y: 8 },
        direction: "column",
        gap: 4,
        padding: 10,
        width: SIDEBAR_WIDTH,
        // Cap the panel at the canvas height (with a margin matching the
        // anchor offset on top + bottom) and clip the overflow. Sections
        // expanded enough to overflow the cap are scrollable via the wheel
        // handler installed in main() — it offsets `scroller`'s top margin.
        maxHeight: VIRTUAL_HEIGHT - 16,
        overflow: "hidden",
        background: { color: 0x000000, alpha: 0.85, radius: 6 },
      }),
    );

    // Everything visible inside the sidebar lives inside `scroller`, the
    // sole child of the sidebar's flex column. Wheel scrolling translates
    // `scroller` via a negative top margin, sliding overflowing content
    // under the sidebar's mask. Title goes inside the scroller too so the
    // whole panel scrolls as one document — pinning the title outside lets
    // scrolled rows draw over it (no z-isolation between sidebar children).
    const scroller = sidebar.panel({
      direction: "column",
      gap: 4,
    });
    activeScroller = scroller;
    activeSidebar = sidebar.root;
    // After a rebuild (initial spawn or afterRestore), reset scroll so the
    // newly-built panel starts at the top.
    sidebarScrollY = 0;

    scroller.text("Effects Showcase", TXT_TITLE);

    // Collapsible sections — clicking the header toggles the child panel's
    // visibility. Without this the full preset list overflows the canvas.
    // `defaultOpen=false` for everything except the first section keeps the
    // initial paint short; users expand whichever scope they want.
    const section = (title: string, defaultOpen = false): UIPanel => {
      let isOpen = defaultOpen;
      const headerBtn = scroller.button(`${isOpen ? "▼" : "▶"} ${title}`, {
        height: 22,
        width: SIDEBAR_WIDTH - 20,
        background: { color: 0x111827, alpha: 1, radius: 4 },
        hoverBackground: { color: 0x1f2937, alpha: 1, radius: 4 },
        pressBackground: { color: 0x1f2937, alpha: 1, radius: 4 },
        textStyle: TXT_HEADING,
        onClick: () => {
          isOpen = !isOpen;
          inner.visible = isOpen;
          headerBtn.update({ children: `${isOpen ? "▼" : "▶"} ${title}` });
        },
      });
      const inner = scroller.panel({
        direction: "column",
        gap: 3,
        padding: { left: 4 },
        visible: isOpen,
      });
      return inner as UIPanel;
    };

    const mkToggle = (
      host: UIPanel,
      label: string,
      key: string,
      attach: () => EffectHandle,
    ): void => {
      const btn = host.button(label, {
        height: 22,
        width: SIDEBAR_WIDTH - 28,
        background: BTN_OFF,
        hoverBackground: BTN_OFF_HOVER,
        pressBackground: BTN_OFF_HOVER,
        textStyle: TXT_LABEL,
        onClick: () => {
          const existing = this.effectHandles.get(key);
          if (existing) {
            existing.remove();
            this.effectHandles.set(key, null);
            paintButton(btn, false);
          } else {
            this.effectHandles.set(key, attach());
            paintButton(btn, true);
          }
        },
      });
      this.toggleButtons.set(key, btn);
    };

    const mkAction = (
      host: UIPanel,
      label: string,
      onClick: () => void,
      bg: ColorBackground = BTN_ACCENT,
      bgHover: ColorBackground = BTN_ACCENT_HOVER,
    ): void => {
      host.button(label, {
        height: 22,
        width: SIDEBAR_WIDTH - 28,
        background: bg,
        hoverBackground: bgHover,
        pressBackground: bgHover,
        textStyle: TXT_LABEL,
        onClick,
      });
    };

    // ---- Component (sprite) ----
    const componentSection = section("Component (per-entity)", true);
    mkAction(componentSection, "Hit Flash trigger", () =>
      this.hero?.flashHandle?.trigger(),
    );
    mkToggle(componentSection, "outline (block)", "outline", () => {
      const g = this.block?.tryGet(GraphicsComponent);
      if (!g) throw new Error("block graphics missing");
      return g.fx.addEffect(outline({ thickness: 4, color: 0x000000 }));
    });
    mkToggle(componentSection, "dropShadow (block)", "dropShadow", () => {
      const g = this.block?.tryGet(GraphicsComponent);
      if (!g) throw new Error("block graphics missing");
      return g.fx.addEffect(
        dropShadow({ offset: { x: 8, y: 8 }, alpha: 0.7 }),
      );
    });
    mkToggle(componentSection, "glow (gem)", "glow", () => {
      const g = this.gem?.tryGet(GraphicsComponent);
      if (!g) throw new Error("gem graphics missing");
      return g.fx.addEffect(glow({ color: 0xffff00, outerStrength: 3 }));
    });

    // ---- Layer (world only — UI unaffected) ----
    const layerSection = section("Layer · world (UI unaffected)");
    mkToggle(layerSection, "bloom", "bloom", () =>
      tree
        .get("world")
        .fx.addEffect(bloom({ threshold: 0.3, bloomScale: 1.4 })),
    );
    mkToggle(layerSection, "pixelate", "pixelate", () =>
      tree.get("world").fx.addEffect(pixelate({ size: 6 })),
    );
    mkToggle(layerSection, "motionBlur", "motionBlur", () =>
      tree
        .get("world")
        .fx.addEffect(motionBlur({ velocity: { x: 24, y: 0 } })),
    );
    mkToggle(layerSection, "oldFilm", "oldFilm", () =>
      tree.get("world").fx.addEffect(oldFilm({ sepia: 0.4, noise: 0.4 })),
    );
    mkToggle(layerSection, "halftone (custom shader)", "halftone", () =>
      tree
        .get("world")
        .fx.addEffect(halftone({ size: 6, angle: Math.PI / 4 })),
    );
    mkToggle(layerSection, "wave (custom shader)", "wave", () =>
      tree
        .get("world")
        .fx.addEffect(wave({ amplitude: 5, wavelength: 60, speed: 0.8 })),
    );

    // ---- Scene (covers UI too) ----
    // godRay, bulgePinch, shockwave attach here rather than to the world
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
    const sceneSection = section("Scene (covers UI too)");
    mkToggle(sceneSection, "crt", "crt", () =>
      tree.fx.addEffect(crt({ lineContrast: 0.3 })),
    );
    mkToggle(sceneSection, "colorGrade: sepia", "colorGrade", () =>
      tree.fx.addEffect(colorGrade({ preset: "sepia" })),
    );
    mkToggle(sceneSection, "chromaticAberration", "ca", () =>
      tree.fx.addEffect(chromaticAberration({ separation: 4 })),
    );
    mkToggle(sceneSection, "godRay", "godRay", () =>
      tree.fx.addEffect(godRay({ angle: 25, gain: 0.5 })),
    );
    mkToggle(sceneSection, "bulgePinch", "bulgePinch", () =>
      tree.fx.addEffect(
        // Center is normalized scene coords (0..1), so { 0.5, 0.5 } is
        // dead-center of the canvas regardless of resolution.
        bulgePinch({
          strength: 0.6,
          radius: 260,
          center: { x: 0.4, y: 0.5 },
        }),
      ),
    );
    mkToggle(sceneSection, "shockwave (toggle, then trigger)", "shockwave", () =>
      tree.fx.addEffect(
        shockwave({ amplitude: 30, wavelength: 120, duration: 0.9 }),
      ),
    );
    mkAction(sceneSection, "Trigger shockwave on hero", () => {
      const h = this.effectHandles.get("shockwave") as
        | ShockwaveHandle
        | undefined;
      if (!h) {
        showToast("Toggle shockwave on first");
        return;
      }
      // `trigger` accepts coords in the filter target's local space —
      // virtual pixels for scene-scope. The wrapper handles the canvas /
      // fit / camera conversion internally each frame.
      const pos = this.hero?.tryGet(Transform)?.position;
      h.trigger(pos?.x ?? VIRTUAL_WIDTH / 2, pos?.y ?? VIRTUAL_HEIGHT / 2);
    });

    // ---- Screen (covers UI too) ----
    const screenSection = section("Screen (covers UI too)");
    mkToggle(screenSection, "vignette", "vignette", () =>
      renderer.fx.addEffect(vignette({ alpha: 0.6 })),
    );

    // ---- Fades — operate on whichever handle is currently attached. ----
    const fadesSection = section("Fades");
    const fadeBtn = (key: string, label: string, seconds: number, dir: "in" | "out"): void => {
      mkAction(
        fadesSection,
        label,
        () => {
          const h = this.effectHandles.get(key);
          if (!h) {
            showToast(`Toggle ${key} on first`);
            return;
          }
          if (dir === "in") h.fadeIn(seconds);
          else h.fadeOut(seconds);
        },
        BTN_OFF,
        BTN_OFF_HOVER,
      );
    };
    fadeBtn("bloom", "bloom: fade out 1s", 1, "out");
    fadeBtn("bloom", "bloom: fade in 1s", 1, "in");
    fadeBtn("vignette", "vignette: fade out 1s", 1, "out");
    fadeBtn("vignette", "vignette: fade in 1s", 1, "in");

    // ---- Masks — exclusive setMask/clearMask, not addEffect. ----
    const masksSection = section("Masks");
    {
      const gemGfx = this.gem?.tryGet(GraphicsComponent);
      const blockGfx = this.block?.tryGet(GraphicsComponent);
      let gemHandle: MaskHandle | null = gemGfx?.mask ?? null;
      let gemInverse = gemHandle?.inverse ?? false;
      let blockHandle: MaskHandle | null = blockGfx?.mask ?? null;

      const maskGem = masksSection.button("Mask gem (top half)", {
        height: 22,
        width: SIDEBAR_WIDTH - 28,
        background: gemHandle ? BTN_ON : BTN_OFF,
        hoverBackground: gemHandle ? BTN_ON_HOVER : BTN_OFF_HOVER,
        textStyle: TXT_LABEL,
        onClick: () => {
          if (gemHandle) {
            gemHandle.remove();
            gemHandle = null;
            gemInverse = false;
            paintButton(maskGem, false);
            paintButton(inverseGem, false);
            return;
          }
          if (!gemGfx) throw new Error("gem graphics missing");
          gemHandle = gemGfx.setMask(
            rectMask({ x: -55, y: -55, width: 110, height: 55 }),
          );
          paintButton(maskGem, true);
        },
      });

      const inverseGem = masksSection.button("Toggle gem mask inverse", {
        height: 22,
        width: SIDEBAR_WIDTH - 28,
        background: gemInverse ? BTN_ON : BTN_OFF,
        hoverBackground: gemInverse ? BTN_ON_HOVER : BTN_OFF_HOVER,
        textStyle: TXT_LABEL,
        onClick: () => {
          if (!gemHandle) {
            showToast("Mask gem first");
            return;
          }
          gemInverse = !gemInverse;
          gemHandle.setInverse(gemInverse);
          paintButton(inverseGem, gemInverse);
        },
      });

      const maskBlock = masksSection.button("Mask block (graphicsMask)", {
        height: 22,
        width: SIDEBAR_WIDTH - 28,
        background: blockHandle ? BTN_ON : BTN_OFF,
        hoverBackground: blockHandle ? BTN_ON_HOVER : BTN_OFF_HOVER,
        textStyle: TXT_LABEL,
        onClick: () => {
          if (blockHandle) {
            blockHandle.remove();
            blockHandle = null;
            paintButton(maskBlock, false);
            return;
          }
          if (!blockGfx) throw new Error("block graphics missing");
          blockHandle = blockGfx.setMask(
            graphicsMask((mg) => {
              mg.clear();
              mg.circle(0, 0, 55);
              mg.fill({ color: 0xffffff });
            }),
          );
          paintButton(maskBlock, true);
        },
      });
    }

    // ---- Save / Load ----
    const saveSection = section("Save / Load (S / L)");
    mkAction(saveSection, "Save", () => this.doSave());
    mkAction(saveSection, "Load", () => void this.doLoad());
  }

  doSave(): void {
    // Wrap the whole save in try/catch so a failure surfaces as a visible
    // "Save failed" toast + console error rather than silently swallowing
    // the success toast. Without this, any throw inside `buildSnapshot` or
    // `JSON.stringify` (a serialize() that errors, a localStorage quota
    // hit, etc.) leaves the user thinking they saved when they didn't —
    // a subsequent Load then logs "No save" with no breadcrumb.
    try {
      const save = this.context.resolve(SnapshotServiceKey);
      save.saveSnapshot("showcase");
      showToast("Saved");
    } catch (err) {
      console.error("Save failed:", err);
      showToast("Save failed");
    }
  }

  async doLoad(): Promise<void> {
    const save = this.context.resolve(SnapshotServiceKey);
    // Capture the SceneManager BEFORE the await — `loadSnapshot` calls
    // `popAll()` then pushes a fresh ShowcaseScene from the snapshot, so
    // `this` is a destroyed shell by the time the promise resolves and
    // `this.context` may no longer route. We need the new active scene to
    // sync the freshly-built panel against the just-restored effects.
    const sceneManager = this.context.resolve(SceneManagerKey);
    if (!save.hasSnapshot("showcase")) {
      showToast("No save");
      return;
    }
    try {
      await save.loadSnapshot("showcase");
      const active = sceneManager.active;
      if (active instanceof ShowcaseScene) {
        active.syncPanelToRestoredEffects();
      }
      showToast("Loaded");
    } catch (err) {
      console.error("Load failed:", err);
      showToast("Load failed");
    }
  }
}

// Module-level state for the sidebar scroller. `buildPanel` rewires these
// each time it runs (initial spawn + every load), so the wheel handler in
// `main()` always operates on the live UIPanels — no per-scene listener
// teardown needed across save/load.
let activeScroller: UIPanel | null = null;
let activeSidebar: UIPanel | null = null;
let sidebarScrollY = 0;

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });

  const container = setupGameContainer(VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
  engine.use(
    new RendererPlugin({
      width: VIRTUAL_WIDTH,
      height: VIRTUAL_HEIGHT,
      backgroundColor: 0x000000,
      container,
    }),
  );
  engine.use(new SnapshotPlugin());
  engine.use(new UIPlugin());
  await installDebugFromUrl(engine);

  // Wheel-scroll the sidebar when the pointer is over it. Yoga's
  // `margin.top: -scrollY` on `scroller` slides overflowing content up under
  // the sidebar's `overflow: "hidden"` mask — no per-frame layout hook
  // required; Yoga incorporates the offset on the next layout pass.
  container.addEventListener(
    "wheel",
    (e) => {
      const scroller = activeScroller;
      const sidebar = activeSidebar;
      if (!scroller || !sidebar) return;
      const canvas = container.querySelector("canvas");
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = ((e.clientX - rect.left) * VIRTUAL_WIDTH) / rect.width;
      const cy = ((e.clientY - rect.top) * VIRTUAL_HEIGHT) / rect.height;
      const left = VIRTUAL_WIDTH - SIDEBAR_WIDTH - 8;
      if (cx < left || cx > VIRTUAL_WIDTH - 8 || cy < 8 || cy > VIRTUAL_HEIGHT - 8) {
        return;
      }
      const visibleH = sidebar.yogaNode.getComputedHeight();
      const contentH = scroller.yogaNode.getComputedHeight();
      // Subtract sidebar's top + bottom padding (10px each) to get the
      // scrollable viewport height. The title scrolls with the rest now.
      const chromeH = 20;
      const maxScroll = Math.max(0, contentH - (visibleH - chromeH));
      const next = Math.max(0, Math.min(maxScroll, sidebarScrollY + e.deltaY));
      if (next !== sidebarScrollY) {
        sidebarScrollY = next;
        scroller.update({ margin: { top: -sidebarScrollY } });
      }
      e.preventDefault();
    },
    { passive: false },
  );

  // Hotkeys — bare S/L only, so Cmd/Ctrl+S (browser save) and Cmd/Ctrl+L
  // (focus address bar) keep their default behavior.
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const scene = engine.scenes.active as ShowcaseScene | null;
    if (!scene) return;
    if (e.key.toLowerCase() === "s") scene.doSave();
    if (e.key.toLowerCase() === "l") void scene.doLoad();
  });

  await engine.start();
  await engine.scenes.push(new ShowcaseScene());
}

void main();
