/**
 * Effects showcase — exercises every preset in `@yagejs/effects` at each
 * scope (component, layer, scene, screen) and demonstrates that the state
 * survives a save/load round-trip.
 *
 * Geometry is procedural (`GraphicsComponent.draw`) and the engine doesn't
 * persist drawing commands across save/load, so each shape lives on its
 * own `@serializable` entity that re-runs its draw in `afterRestore()`.
 */

import {
  Component,
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
import { SavePlugin, SaveServiceKey } from "@yagejs/save";
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
} from "@yagejs/effects";
import type { CRTHandle, HitFlashHandle } from "@yagejs/effects";
import { injectStyles, setupGameContainer } from "./shared.js";

const STAGE_WIDTH = 800;
const STAGE_HEIGHT = 600;

injectStyles(`
  #panel {
    position: fixed; top: 1rem; right: 1rem;
    background: rgba(0,0,0,0.85); color: #ffe66d;
    font-family: monospace; font-size: 0.85rem;
    padding: 0.75rem 1rem; border-radius: 6px;
    line-height: 1.6; min-width: 12rem;
  }
  #panel h3 { margin: 0.5rem 0 0.25rem; color: #fff; font-size: 0.9rem; }
  #panel button {
    display: block; width: 100%; margin: 0.15rem 0;
    background: #1f2937; color: #ffe66d; border: 1px solid #374151;
    padding: 0.25rem 0.5rem; cursor: pointer; font-family: monospace;
    text-align: left;
  }
  #panel button.on { background: #0ea5e9; color: #fff; }
  #panel button:hover { background: #374151; }
  #panel button.on:hover { background: #0284c7; }
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

const panel = document.createElement("div");
panel.id = "panel";
document.body.appendChild(panel);

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

const layers: LayerDef[] = [
  { name: "background", order: -10 },
  { name: "world", order: 0 },
  { name: "hud", order: 100 },
];

/** Drives a list of step(dt) callbacks every frame so we can animate
 * effects (CRT noise, hit-flash trigger) under engine time. */
class EffectTicker extends Component {
  readonly tickers: Array<(dt: number) => void> = [];
  update(dt: number): void {
    for (const fn of this.tickers) fn(dt);
  }
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
      // Deep gradient sky — purple → teal — anchored to the canvas.
      const sky = linearGradient({
        axis: "vertical",
        stops: [
          { offset: 0, color: 0x1e1b4b },
          { offset: 0.5, color: 0x312e81 },
          { offset: 1, color: 0x065f46 },
        ],
      });
      ctx.rect(0, 0, STAGE_WIDTH, STAGE_HEIGHT).fill(sky);

      // Subtle radial highlight in the upper-left to break up the flat fill.
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

      // Grid lines so pixelate / chromaticAberration / CRT have geometry to chew on.
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

      // Scattered glowing dots — predictable positions so the visual
      // doesn't shift across saves.
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

  setup(): void {
    this.add(new Transform({ position: new Vec2(250, 320) }));
    this.add(new GraphicsComponent({ layer: "world" }));
    this.redraw();
    this.attachHitFlash();
  }

  afterRestore(): void {
    this.redraw();
    // GraphicsComponent.afterRestore already rebuilt the saved hitFlash;
    // recover its handle so the trigger button keeps working.
    const g = this.tryGet(GraphicsComponent);
    this.flashHandle = g?.findEffect(hitFlash) ?? null;
    if (!this.flashHandle) this.attachHitFlash();
  }

  private attachHitFlash(): void {
    const g = this.tryGet(GraphicsComponent);
    if (!g) return;
    this.flashHandle = g.addEffect(
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
    this.add(new Transform({ position: new Vec2(470, 320) }));
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
    this.add(new Transform({ position: new Vec2(670, 320) }));
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

/** Hosts the per-frame ticker component used to advance step(dt) effects.
 * `EffectTicker` is stateless and has no @serializable wiring, so the
 * entity rebuilds it from scratch in `afterRestore`. */
@serializable
class TickerEntity extends Entity {
  ticker: EffectTicker | null = null;

  setup(): void {
    this.ticker = new EffectTicker();
    this.add(this.ticker);
  }

  afterRestore(): void {
    this.ticker = new EffectTicker();
    this.add(this.ticker);
  }
}

@serializable
class ShowcaseScene extends Scene {
  readonly name = "effects-showcase";
  readonly layers = layers;

  private effectHandles = new Map<string, EffectHandle | null>();
  private crtHandle: CRTHandle | null = null;
  private background: BackgroundEntity | null = null;
  private hero: HeroEntity | null = null;
  private block: BlockEntity | null = null;
  private gem: GemEntity | null = null;
  private tickerEntity: TickerEntity | null = null;

  onEnter(): void {
    this.background = this.spawn(BackgroundEntity);
    this.hero = this.spawn(HeroEntity);
    this.block = this.spawn(BlockEntity);
    this.gem = this.spawn(GemEntity);
    this.tickerEntity = this.spawn(TickerEntity);

    this.bindFlashTicker();
    this.buildPanel();
  }

  afterRestore(): void {
    // Recover entity references by walking the restored entity list. Order
    // is determined by save-time spawn order, but each is a single instance
    // here so a per-class find is safe.
    for (const e of this.getEntities()) {
      if (e instanceof BackgroundEntity) this.background = e;
      else if (e instanceof HeroEntity) this.hero = e;
      else if (e instanceof BlockEntity) this.block = e;
      else if (e instanceof GemEntity) this.gem = e;
      else if (e instanceof TickerEntity) this.tickerEntity = e;
    }

    this.effectHandles.clear();
    this.bindFlashTicker();
    this.buildPanel();

    // The renderer's snapshot contributor runs AFTER scene.afterRestore,
    // so the layer/scene/screen effects we want to reflect in the panel
    // don't exist yet. Defer the sync to the next macrotask, which fires
    // after `loadSnapshot()` (and its contributor pass) has resolved.
    setTimeout(() => this.syncPanelToRestoredEffects(), 0);
  }

  /** After load, the renderer has rebuilt every saved effect at every
   * scope, but the panel's `effectHandles` map is empty. Walk each scope
   * for the presets we expose buttons for, recover their handles, and
   * mark the corresponding buttons as "on". */
  private syncPanelToRestoredEffects(): void {
    const tree = this.context.resolve(SceneRenderTreeProviderKey).getTree(this);
    if (!tree) return;
    const renderer = this.context.resolve(RendererKey);
    const world = tree.tryGet("world");

    const sync = (key: string, handle: EffectHandle | null): void => {
      if (!handle) return;
      this.effectHandles.set(key, handle);
      const btn = panel.querySelector<HTMLButtonElement>(
        `button[data-toggle-key="${key}"]`,
      );
      btn?.classList.add("on");
    };

    sync("outline", this.block?.tryGet(GraphicsComponent)?.findEffect(outline) ?? null);
    sync("dropShadow", this.block?.tryGet(GraphicsComponent)?.findEffect(dropShadow) ?? null);
    sync("glow", this.gem?.tryGet(GraphicsComponent)?.findEffect(glow) ?? null);
    sync("bloom", world?.findEffect(bloom) ?? null);
    sync("pixelate", world?.findEffect(pixelate) ?? null);

    const restoredCrt = tree.findEffect(crt);
    if (restoredCrt) {
      this.crtHandle = restoredCrt;
      this.tickerEntity?.ticker?.tickers.push((dt) => restoredCrt.step(dt));
      sync("crt", restoredCrt);
    }
    sync("colorGrade", tree.findEffect(colorGrade));
    sync("ca", tree.findEffect(chromaticAberration));
    sync("vignette", renderer.findEffect(vignette));
  }

  /** Wire the per-frame tickers for hitFlash + (if active) CRT. */
  private bindFlashTicker(): void {
    const ticker = this.tickerEntity?.ticker;
    if (!ticker) return;
    ticker.tickers.length = 0;
    ticker.tickers.push((dt) => this.hero?.flashHandle?.step(dt));
    if (this.crtHandle) {
      const crtRef = this.crtHandle;
      ticker.tickers.push((dt) => crtRef.step(dt));
    }
  }

  private buildPanel(): void {
    const tree = this.context.resolve(SceneRenderTreeProviderKey).getTree(this);
    if (!tree) throw new Error("scene render tree not yet attached");
    const renderer = this.context.resolve(RendererKey);

    panel.innerHTML = "";

    const section = (title: string): void => {
      const h = document.createElement("h3");
      h.textContent = title;
      panel.appendChild(h);
    };

    const toggle = (
      label: string,
      key: string,
      attach: () => EffectHandle,
      onActivate?: (h: EffectHandle) => void,
      onDeactivate?: () => void,
    ): void => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.dataset.toggleKey = key;
      btn.onclick = () => {
        const existing = this.effectHandles.get(key);
        if (existing) {
          existing.remove();
          this.effectHandles.set(key, null);
          btn.classList.remove("on");
          onDeactivate?.();
        } else {
          const handle = attach();
          this.effectHandles.set(key, handle);
          btn.classList.add("on");
          onActivate?.(handle);
        }
      };
      panel.appendChild(btn);
    };

    section("Component (sprite)");
    {
      const btn = document.createElement("button");
      btn.textContent = "Hit Flash trigger";
      btn.onclick = () => this.hero?.flashHandle?.trigger();
      panel.appendChild(btn);
    }
    toggle("outline (block)", "outline", () => {
      const g = this.block?.tryGet(GraphicsComponent);
      if (!g) throw new Error("block graphics missing");
      return g.addEffect(outline({ thickness: 4, color: 0x000000 }));
    });
    toggle("dropShadow (block)", "dropShadow", () => {
      const g = this.block?.tryGet(GraphicsComponent);
      if (!g) throw new Error("block graphics missing");
      return g.addEffect(dropShadow({ offset: { x: 8, y: 8 }, alpha: 0.7 }));
    });
    toggle("glow (gem)", "glow", () => {
      const g = this.gem?.tryGet(GraphicsComponent);
      if (!g) throw new Error("gem graphics missing");
      return g.addEffect(glow({ color: 0xffff00, outerStrength: 3 }));
    });

    section("Layer (world)");
    toggle("bloom", "bloom", () =>
      tree.get("world").addEffect(bloom({ threshold: 0.3, bloomScale: 1.4 })),
    );
    toggle("pixelate", "pixelate", () =>
      tree.get("world").addEffect(pixelate({ size: 6 })),
    );

    section("Scene");
    toggle(
      "crt",
      "crt",
      () => {
        const h = tree.addEffect(crt({ lineContrast: 0.3 }));
        this.crtHandle = h;
        return h;
      },
      (h) => {
        const crtRef = h as CRTHandle;
        this.tickerEntity?.ticker?.tickers.push((dt) => crtRef.step(dt));
      },
      () => {
        this.crtHandle = null;
        const ticker = this.tickerEntity?.ticker;
        if (!ticker) return;
        // Drop everything and re-bind the persistent tickers (hitFlash).
        // Cheaper than tracking individual fn refs through closures.
        this.bindFlashTicker();
      },
    );
    toggle("colorGrade: sepia", "colorGrade", () =>
      tree.addEffect(colorGrade({ preset: "sepia" })),
    );
    toggle("chromaticAberration", "ca", () =>
      tree.addEffect(chromaticAberration({ separation: 4 })),
    );

    section("Screen (cross-scene)");
    toggle("vignette", "vignette", () =>
      renderer.addEffect(vignette({ alpha: 0.6 })),
    );

    // ---- Fades (intensity tweens) ----
    //
    // Every effect handle has fadeIn(ms) / fadeOut(ms) that tween the
    // effect's primary intensity uniform. The fade is scheduled through
    // the same scope-bound process host that backs the rest of the
    // engine, so layer/scene-scope fades pause with the scene; the
    // screen-scope vignette fade keeps running across scene transitions.
    //
    // For a button-driven demo we operate on whichever handle is already
    // attached via the toggles above — toggle bloom or vignette on, then
    // fade it.
    section("Fades");
    const fadeBtn = (label: string, key: string, ms: number, dir: "in" | "out"): void => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.onclick = () => {
        const h = this.effectHandles.get(key);
        if (!h) {
          showToast(`Toggle ${key} on first`);
          return;
        }
        if (dir === "in") h.fadeIn(ms);
        else h.fadeOut(ms);
      };
      panel.appendChild(btn);
    };
    fadeBtn("bloom: fade out 1s", "bloom", 1000, "out");
    fadeBtn("bloom: fade in 1s", "bloom", 1000, "in");
    fadeBtn("vignette: fade out 1s", "vignette", 1000, "out");
    fadeBtn("vignette: fade in 1s", "vignette", 1000, "in");

    // ---- Masks ----
    //
    // Masks are exclusive (one per container) so they use a separate API
    // from addEffect: setMask / clearMask. Mask handles aren't tracked in
    // the long-lived effectHandles map — they're closure-local here and
    // the panel doesn't try to re-light their toggles after a load.
    // (`rectMask` survives the save round-trip; `graphicsMask` does not,
    // because its draw closure can't be serialized.)
    section("Masks");
    {
      let gemHandle: MaskHandle | null = null;
      let gemInverse = false;
      const maskGem = document.createElement("button");
      maskGem.textContent = "Mask gem (rounded rect)";
      maskGem.onclick = () => {
        if (gemHandle) {
          gemHandle.remove();
          gemHandle = null;
          gemInverse = false;
          maskGem.classList.remove("on");
          inverseGem.classList.remove("on");
          return;
        }
        const g = this.gem?.tryGet(GraphicsComponent);
        if (!g) throw new Error("gem graphics missing");
        gemHandle = g.setMask(
          // Clip to the top half of the diamond polygon.
          rectMask({ x: -55, y: -55, width: 110, height: 55, rounded: 8 }),
        );
        maskGem.classList.add("on");
      };
      panel.appendChild(maskGem);

      const inverseGem = document.createElement("button");
      inverseGem.textContent = "Toggle gem mask inverse";
      inverseGem.onclick = () => {
        if (!gemHandle) {
          showToast("Mask gem first");
          return;
        }
        gemInverse = !gemInverse;
        gemHandle.setInverse(gemInverse);
        inverseGem.classList.toggle("on", gemInverse);
      };
      panel.appendChild(inverseGem);

      let blockHandle: MaskHandle | null = null;
      const maskBlock = document.createElement("button");
      maskBlock.textContent = "Mask block (graphicsMask circle)";
      maskBlock.onclick = () => {
        if (blockHandle) {
          blockHandle.remove();
          blockHandle = null;
          maskBlock.classList.remove("on");
          return;
        }
        const g = this.block?.tryGet(GraphicsComponent);
        if (!g) throw new Error("block graphics missing");
        // graphicsMask gotchas:
        //   1. Always g.clear() first — pixi commands accumulate, so each
        //      redraw() would otherwise stack another shape on top.
        //   2. Read live state inside the closure; never snapshot a
        //      `const` outside, or redraw() keeps using the original.
        //   The block's drawn extent is static (-60..60), so capturing
        //   the literal radius is fine here. For dynamic dimensions
        //   (e.g. a UIPanel), reach through to the live source on each
        //   call — see UIPanel's own setMask call site.
        blockHandle = g.setMask(
          graphicsMask((mg) => {
            mg.clear();
            mg.circle(0, 0, 55);
            mg.fill({ color: 0xffffff });
          }),
        );
        maskBlock.classList.add("on");
      };
      panel.appendChild(maskBlock);
    }

    section("Save / Load");
    {
      const save = document.createElement("button");
      save.textContent = "Save (S)";
      save.onclick = () => this.doSave();
      panel.appendChild(save);
      const load = document.createElement("button");
      load.textContent = "Load (L)";
      load.onclick = () => void this.doLoad();
      panel.appendChild(load);
    }
  }

  doSave(): void {
    const save = this.context.resolve(SaveServiceKey);
    save.saveSnapshot("showcase");
    showToast("Saved");
  }

  async doLoad(): Promise<void> {
    const save = this.context.resolve(SaveServiceKey);
    if (!save.hasSnapshot("showcase")) {
      showToast("No save");
      return;
    }
    await save.loadSnapshot("showcase");
    showToast("Loaded");
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
  engine.use(new SavePlugin());

  // Hotkeys.
  window.addEventListener("keydown", (e) => {
    const scene = engine.scenes.active as ShowcaseScene | null;
    if (!scene) return;
    if (e.key.toLowerCase() === "s") scene.doSave();
    if (e.key.toLowerCase() === "l") void scene.doLoad();
  });

  await engine.start();
  await engine.scenes.push(new ShowcaseScene());
}

void main();
