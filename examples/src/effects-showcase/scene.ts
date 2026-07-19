import {
  Scene,
  SceneManagerKey,
  Transform,
  Vec2,
  serializable,
} from "@yagejs/core";
import {
  GraphicsComponent,
  RendererKey,
  SceneRenderTreeProviderKey,
  TextComponent,
  graphicsMask,
  rectMask,
} from "@yagejs/renderer";
import type { EffectHandle, MaskHandle } from "@yagejs/renderer";
import { SnapshotServiceKey } from "@yagejs/save";
import {
  UISurface,
  UIButton,
  UIPanel,
  Anchor,
  type ColorBackground,
} from "@yagejs/ui";
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
import {
  VIRTUAL_WIDTH,
  VIRTUAL_HEIGHT,
  SIDEBAR_WIDTH,
  layers,
  BTN_OFF,
  BTN_OFF_HOVER,
  BTN_ON,
  BTN_ON_HOVER,
  BTN_ACCENT,
  BTN_ACCENT_HOVER,
  TXT_LABEL,
  TXT_HEADING,
  TXT_TITLE,
  paintButton,
} from "./constants.js";
import {
  BackgroundEntity,
  HeroEntity,
  BlockEntity,
  GemEntity,
} from "./entities.js";
import { bindToast, showToast } from "./toast.js";
import { bindSidebar } from "./sidebar-scroll.js";

@serializable
export class ShowcaseScene extends Scene {
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

    this.spawnToast();
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
    this.spawnToast();
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

  // Spawn the in-canvas toast and bind it. Called on both onEnter and
  // afterRestore (a load rebuilds the scene) so `showToast` keeps a live target.
  private spawnToast(): void {
    const toastEntity = this.spawn("toast");
    toastEntity.add(
      new Transform({
        position: new Vec2(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT - 28),
      }),
    );
    const toastText = toastEntity.add(
      new TextComponent({
        text: "",
        anchor: { x: 0.5, y: 0.5 },
        style: { fontFamily: "monospace", fontSize: 13, fill: 0x22c55e },
        layer: "ui",
      }),
    );
    toastText.visible = false;
    bindToast(toastText);
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
    bindSidebar(scroller, sidebar.root);

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
      return g.fx.addEffect(dropShadow({ offset: { x: 8, y: 8 }, alpha: 0.7 }));
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
      tree.get("world").fx.addEffect(motionBlur({ velocity: { x: 24, y: 0 } })),
    );
    mkToggle(layerSection, "oldFilm", "oldFilm", () =>
      tree.get("world").fx.addEffect(oldFilm({ sepia: 0.4, noise: 0.4 })),
    );
    mkToggle(layerSection, "halftone (custom shader)", "halftone", () =>
      tree.get("world").fx.addEffect(halftone({ size: 6, angle: Math.PI / 4 })),
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
    mkToggle(
      sceneSection,
      "shockwave (toggle, then trigger)",
      "shockwave",
      () =>
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
    const fadeBtn = (
      key: string,
      label: string,
      seconds: number,
      dir: "in" | "out",
    ): void => {
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
