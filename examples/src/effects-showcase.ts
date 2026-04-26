/**
 * Effects showcase — exercises every preset in `@yagejs/effects` at each
 * scope (component, layer, scene, screen) and demonstrates that the state
 * survives a save/load round-trip.
 */

import {
  Component,
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
  type LayerDef,
} from "@yagejs/renderer";
import type {
  EffectHandle,
} from "@yagejs/renderer";
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

@serializable
class ShowcaseScene extends Scene {
  readonly name = "effects-showcase";
  readonly layers = layers;

  // Stored handles so toggle UI can flip them on/off and so trigger() is reachable.
  private flashHandle: HitFlashHandle | null = null;
  private crtHandle: CRTHandle | null = null;
  private ticker: EffectTicker | null = null;
  private effectHandles = new Map<string, EffectHandle | null>();

  onEnter(): void {
    // Blue circle — gets the per-component hitFlash trigger.
    const hero = this.spawn("hero");
    hero.add(new Transform({ position: new Vec2(220, 320) }));
    const heroG = new GraphicsComponent({ layer: "world" }).draw((g) => {
      g.circle(0, 0, 60).fill({ color: 0x38bdf8 });
      g.circle(0, 0, 60).stroke({ color: 0x0ea5e9, width: 4 });
    });
    hero.add(heroG);

    // Orange square — for outline / drop shadow.
    const block = this.spawn("block");
    block.add(new Transform({ position: new Vec2(440, 320) }));
    const blockG = new GraphicsComponent({ layer: "world" }).draw((g) => {
      g.rect(-60, -60, 120, 120).fill({ color: 0xf97316 });
    });
    block.add(blockG);

    // Green diamond — empty slot, will get glow.
    const gem = this.spawn("gem");
    gem.add(new Transform({ position: new Vec2(640, 320) }));
    const gemG = new GraphicsComponent({ layer: "world" }).draw((g) => {
      g.poly([0, -55, 50, 0, 0, 55, -50, 0]).fill({ color: 0x22c55e });
    });
    gem.add(gemG);

    // Pre-attach the hitFlash so the `Hit Flash trigger` button has a handle.
    this.flashHandle = heroG.addEffect(
      hitFlash({ color: 0xffffff, duration: 200 }),
    );

    // Tick component drives step()-based effects every frame.
    const tickerEntity = this.spawn("ticker");
    const ticker = new EffectTicker();
    tickerEntity.add(ticker);
    ticker.tickers.push((dt) => this.flashHandle?.step(dt));
    this.ticker = ticker;

    // Build the toggle UI now that scene state exists.
    this.buildPanel(blockG, gemG);
  }

  private buildPanel(
    block: GraphicsComponent,
    gem: GraphicsComponent,
  ): void {
    const tree = this.context.resolve(SceneRenderTreeProviderKey).getTree(this);
    if (!tree) throw new Error("scene render tree not yet attached");
    const renderer = this.context.resolve(RendererKey);

    panel.innerHTML = "";

    const section = (title: string): HTMLElement => {
      const h = document.createElement("h3");
      h.textContent = title;
      panel.appendChild(h);
      return h;
    };

    const toggle = (
      label: string,
      key: string,
      attach: () => EffectHandle,
    ): void => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.onclick = () => {
        const existing = this.effectHandles.get(key);
        if (existing) {
          existing.remove();
          this.effectHandles.set(key, null);
          btn.classList.remove("on");
        } else {
          const handle = attach();
          this.effectHandles.set(key, handle);
          btn.classList.add("on");
        }
      };
      panel.appendChild(btn);
    };

    section("Component (sprite)");
    {
      const btn = document.createElement("button");
      btn.textContent = "Hit Flash trigger";
      btn.onclick = () => this.flashHandle?.trigger();
      panel.appendChild(btn);
    }
    toggle("outline (block)", "outline", () =>
      block.addEffect(outline({ thickness: 4, color: 0x000000 })),
    );
    toggle("dropShadow (block)", "dropShadow", () =>
      block.addEffect(dropShadow({ offset: { x: 6, y: 6 }, alpha: 0.6 })),
    );
    toggle("glow (gem)", "glow", () =>
      gem.addEffect(glow({ color: 0xffff00, outerStrength: 3 })),
    );

    section("Layer (world)");
    toggle("bloom", "bloom", () =>
      tree.get("world").addEffect(bloom({ threshold: 0.5, bloomScale: 1.4 })),
    );
    toggle("pixelate", "pixelate", () =>
      tree.get("world").addEffect(pixelate({ size: 6 })),
    );

    section("Scene");
    toggle("crt", "crt", () => {
      const h = tree.addEffect(crt({ lineContrast: 0.3 }));
      this.crtHandle = h;
      const stepFn = (dt: number) => h.step(dt);
      this.ticker?.tickers.push(stepFn);
      return h;
    });
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
      width: 800,
      height: 600,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(800, 600),
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
