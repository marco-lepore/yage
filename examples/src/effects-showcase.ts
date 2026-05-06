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
import { UIPlugin, UIPanel, UIButton, Anchor, type ColorBackground } from "@yagejs/ui";
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
import { injectStyles, setupGameContainer } from "./shared.js";

const STAGE_WIDTH = 900;
const STAGE_HEIGHT = 640;
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
      ctx.rect(0, 0, STAGE_WIDTH, STAGE_HEIGHT).fill(sky);

      const sun = radialGradient({
        center: { x: 0.25, y: 0.25 },
        outerRadius: 0.7,
        stops: [
          { offset: 0, color: 0xfde68a, alpha: 0.4 },
          { offset: 1, color: 0xfde68a, alpha: 0 },
        ],
        space: "local",
      });
      ctx.rect(0, 0, STAGE_WIDTH, STAGE_HEIGHT).fill(sun);

      // Grid lines so pixelate / chromaticAberration / CRT / halftone /
      // wave have geometry to chew on.
      const gridStep = 40;
      for (let x = 0; x <= STAGE_WIDTH; x += gridStep) {
        ctx
          .moveTo(x, 0)
          .lineTo(x, STAGE_HEIGHT)
          .stroke({ color: 0xffffff, width: 1, alpha: 0.06 });
      }
      for (let y = 0; y <= STAGE_HEIGHT; y += gridStep) {
        ctx
          .moveTo(0, y)
          .lineTo(STAGE_WIDTH, y)
          .stroke({ color: 0xffffff, width: 1, alpha: 0.06 });
      }

      const palette = [0xfacc15, 0xf472b6, 0x60a5fa, 0x34d399, 0xfb923c];
      let seed = 1;
      const rand = (): number => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };
      for (let i = 0; i < 60; i++) {
        const x = rand() * STAGE_WIDTH;
        const y = rand() * STAGE_HEIGHT;
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
  shockwaveHandle: ShockwaveHandle | null = null;

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
    this.shockwaveHandle = g?.fx.findEffect(shockwave) ?? null;
    if (!this.flashHandle) this.attachHitFlash();
  }

  private attachHitFlash(): void {
    const g = this.tryGet(GraphicsComponent);
    if (!g) return;
    this.flashHandle = g.fx.addEffect(
      hitFlash({ color: 0xffffff, duration: 200 }),
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

    const heroGfx = this.hero?.tryGet(GraphicsComponent);
    const blockGfx = this.block?.tryGet(GraphicsComponent);
    const gemGfx = this.gem?.tryGet(GraphicsComponent);

    sync("outline", blockGfx?.fx.findEffect(outline) ?? null);
    sync("dropShadow", blockGfx?.fx.findEffect(dropShadow) ?? null);
    sync("glow", gemGfx?.fx.findEffect(glow) ?? null);
    sync("shockwave", heroGfx?.fx.findEffect(shockwave) ?? null);
    if (this.hero) {
      this.hero.shockwaveHandle = (heroGfx?.fx.findEffect(shockwave) ?? null) as
        | ShockwaveHandle
        | null;
    }
    sync("bloom", world?.fx.findEffect(bloom) ?? null);
    sync("pixelate", world?.fx.findEffect(pixelate) ?? null);
    sync("godRay", world?.fx.findEffect(godRay) ?? null);
    sync("motionBlur", world?.fx.findEffect(motionBlur) ?? null);
    sync("halftone", world?.fx.findEffect(halftone) ?? null);
    sync("wave", world?.fx.findEffect(wave) ?? null);
    sync("oldFilm", world?.fx.findEffect(oldFilm) ?? null);
    sync("bulgePinch", world?.fx.findEffect(bulgePinch) ?? null);
    sync("crt", tree.fx.findEffect(crt));
    sync("colorGrade", tree.fx.findEffect(colorGrade));
    sync("ca", tree.fx.findEffect(chromaticAberration));
    sync("vignette", renderer.fx.findEffect(vignette));
  }

  private buildPanel(): void {
    const tree = this.context.resolve(SceneRenderTreeProviderKey).getTree(this);
    if (!tree) throw new Error("scene render tree not yet attached");
    const renderer = this.context.resolve(RendererKey);

    // The sidebar entity carries the root UIPanel. We rebuild it on every
    // call (initial + afterRestore) — entities and their UI are scene-owned
    // so they're already recreated by the snapshot pipeline; we just need
    // to repopulate the toggle handle map.
    const sidebarEntity = this.spawn("effects-sidebar");
    const sidebar = sidebarEntity.add(
      new UIPanel({
        layer: "ui",
        anchor: Anchor.TopRight,
        offset: { x: -8, y: 8 },
        direction: "column",
        gap: 4,
        padding: 10,
        width: SIDEBAR_WIDTH,
        background: { color: 0x000000, alpha: 0.85, radius: 6 },
      }),
    );

    sidebar.text("Effects Showcase", TXT_TITLE);

    const section = (title: string): void => {
      sidebar.text(title, TXT_HEADING);
    };

    const toggle = (
      label: string,
      key: string,
      attach: () => EffectHandle,
    ): void => {
      const btn = sidebar.button(label, {
        height: 22,
        width: SIDEBAR_WIDTH - 20,
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

    const action = (
      label: string,
      onClick: () => void,
      bg: ColorBackground = BTN_ACCENT,
      bgHover: ColorBackground = BTN_ACCENT_HOVER,
    ): void => {
      sidebar.button(label, {
        height: 22,
        width: SIDEBAR_WIDTH - 20,
        background: bg,
        hoverBackground: bgHover,
        pressBackground: bgHover,
        textStyle: TXT_LABEL,
        onClick,
      });
    };

    section("Component (sprite)");
    action("Hit Flash trigger", () => this.hero?.flashHandle?.trigger());

    toggle("outline (block)", "outline", () => {
      const g = this.block?.tryGet(GraphicsComponent);
      if (!g) throw new Error("block graphics missing");
      return g.fx.addEffect(outline({ thickness: 4, color: 0x000000 }));
    });
    toggle("dropShadow (block)", "dropShadow", () => {
      const g = this.block?.tryGet(GraphicsComponent);
      if (!g) throw new Error("block graphics missing");
      return g.fx.addEffect(dropShadow({ offset: { x: 8, y: 8 }, alpha: 0.7 }));
    });
    toggle("glow (gem)", "glow", () => {
      const g = this.gem?.tryGet(GraphicsComponent);
      if (!g) throw new Error("gem graphics missing");
      return g.fx.addEffect(glow({ color: 0xffff00, outerStrength: 3 }));
    });
    toggle("shockwave (hero)", "shockwave", () => {
      const g = this.hero?.tryGet(GraphicsComponent);
      if (!g) throw new Error("hero graphics missing");
      const handle = g.fx.addEffect(
        shockwave({ amplitude: 24, wavelength: 80, duration: 800 }),
      );
      if (this.hero) this.hero.shockwaveHandle = handle;
      return handle;
    });
    action("Trigger shockwave", () => this.hero?.shockwaveHandle?.trigger(0, 0));

    section("Layer (world only — UI unaffected)");
    toggle("bloom", "bloom", () =>
      tree.get("world").fx.addEffect(bloom({ threshold: 0.3, bloomScale: 1.4 })),
    );
    toggle("pixelate", "pixelate", () =>
      tree.get("world").fx.addEffect(pixelate({ size: 6 })),
    );
    toggle("godRay", "godRay", () =>
      tree.get("world").fx.addEffect(godRay({ angle: 25, gain: 0.5 })),
    );
    toggle("motionBlur", "motionBlur", () =>
      tree.get("world").fx.addEffect(motionBlur({ velocity: { x: 24, y: 0 } })),
    );
    toggle("oldFilm", "oldFilm", () =>
      tree.get("world").fx.addEffect(oldFilm({ sepia: 0.4, noise: 0.4 })),
    );
    toggle("bulgePinch (center)", "bulgePinch", () =>
      tree.get("world").fx.addEffect(
        bulgePinch({
          strength: 0.6,
          radius: 220,
          center: { x: 0.4, y: 0.5 },
        }),
      ),
    );
    toggle("halftone (custom shader)", "halftone", () =>
      tree.get("world").fx.addEffect(
        halftone({ size: 6, angle: Math.PI / 4 }),
      ),
    );
    toggle("wave (custom shader)", "wave", () =>
      tree.get("world").fx.addEffect(
        wave({ amplitude: 5, wavelength: 60, speed: 0.8 }),
      ),
    );

    section("Scene (covers UI too)");
    toggle("crt", "crt", () =>
      tree.fx.addEffect(crt({ lineContrast: 0.3 })),
    );
    toggle("colorGrade: sepia", "colorGrade", () =>
      tree.fx.addEffect(colorGrade({ preset: "sepia" })),
    );
    toggle("chromaticAberration", "ca", () =>
      tree.fx.addEffect(chromaticAberration({ separation: 4 })),
    );

    section("Screen (covers UI too)");
    toggle("vignette", "vignette", () =>
      renderer.fx.addEffect(vignette({ alpha: 0.6 })),
    );

    // ---- Fades — operate on whichever handle is currently attached. ----
    section("Fades");
    const fadeBtn = (
      label: string,
      key: string,
      ms: number,
      dir: "in" | "out",
    ): void => {
      action(
        label,
        () => {
          const h = this.effectHandles.get(key);
          if (!h) {
            showToast(`Toggle ${key} on first`);
            return;
          }
          if (dir === "in") h.fadeIn(ms);
          else h.fadeOut(ms);
        },
        BTN_OFF,
        BTN_OFF_HOVER,
      );
    };
    fadeBtn("bloom: fade out 1s", "bloom", 1000, "out");
    fadeBtn("bloom: fade in 1s", "bloom", 1000, "in");
    fadeBtn("vignette: fade out 1s", "vignette", 1000, "out");
    fadeBtn("vignette: fade in 1s", "vignette", 1000, "in");

    // ---- Masks — exclusive setMask/clearMask, not addEffect. ----
    section("Masks");
    {
      const gemGfx = this.gem?.tryGet(GraphicsComponent);
      const blockGfx = this.block?.tryGet(GraphicsComponent);
      let gemHandle: MaskHandle | null = gemGfx?.mask ?? null;
      let gemInverse = gemHandle?.inverse ?? false;
      let blockHandle: MaskHandle | null = blockGfx?.mask ?? null;

      const maskGem = sidebar.button("Mask gem (top half)", {
        height: 22,
        width: SIDEBAR_WIDTH - 20,
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

      const inverseGem = sidebar.button("Toggle gem mask inverse", {
        height: 22,
        width: SIDEBAR_WIDTH - 20,
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

      const maskBlock = sidebar.button("Mask block (graphicsMask)", {
        height: 22,
        width: SIDEBAR_WIDTH - 20,
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

    section("Save / Load (S / L)");
    action("Save", () => this.doSave());
    action("Load", () => void this.doLoad());
  }

  doSave(): void {
    const save = this.context.resolve(SnapshotServiceKey);
    save.saveSnapshot("showcase");
    showToast("Saved");
  }

  async doLoad(): Promise<void> {
    const save = this.context.resolve(SnapshotServiceKey);
    if (!save.hasSnapshot("showcase")) {
      showToast("No save");
      return;
    }
    try {
      await save.loadSnapshot("showcase");
      this.syncPanelToRestoredEffects();
      showToast("Loaded");
    } catch (err) {
      console.error("Load failed:", err);
      showToast("Load failed");
    }
  }
}

async function main(): Promise<void> {
  const engine = new Engine({ debug: false });

  engine.use(
    new RendererPlugin({
      width: STAGE_WIDTH,
      height: STAGE_HEIGHT,
      backgroundColor: 0x000000,
      container: setupGameContainer(STAGE_WIDTH, STAGE_HEIGHT),
    }),
  );
  engine.use(new SnapshotPlugin());
  engine.use(new UIPlugin());

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
