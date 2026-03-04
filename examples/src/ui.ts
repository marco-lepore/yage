import { Engine, Scene, Vec2 } from "@yage/core";
import { RendererPlugin, CameraKey, GraphicsComponent, texture } from "@yage/renderer";
import {
  UIPlugin,
  UIPanel,
  UIImage,
  UIProgressBar,
  UICheckbox,
  Anchor,
} from "@yage/ui";
import { Transform } from "@yage/core";
import { injectStyles, getContainer } from "./shared.js";
import {
  textStyle, loadFonts, allAssets, nineSliceBtn, panelBg,
} from "./ui-theme.js";

injectStyles();

// ---------------------------------------------------------------------------
// Additional assets for this example
// ---------------------------------------------------------------------------
const Logo = texture("/assets/yage.png");

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class UIExampleScene extends Scene {
  readonly name = "ui-example";
  readonly preload = [...allAssets, Logo];

  onEnter(): void {
    // Center the camera on the world
    const camera = this.context.resolve(CameraKey);
    camera.position = new Vec2(400, 300);

    // A background shape so we can see the UI is in screen-space
    const bg = this.spawn("bg-circle");
    bg.add(new Transform({ position: new Vec2(400, 300) }));
    bg.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 120).fill({ color: 0x1e3a5f, alpha: 0.4 });
        g.circle(0, 0, 120).stroke({ color: 0x38bdf8, width: 2, alpha: 0.3 });
      }),
    );

    // ---- Main menu panel (builder API) ----
    const menuEntity = this.spawn("menu");
    const menu = menuEntity.add(
      new UIPanel({
        anchor: Anchor.Center,
        direction: "column",
        gap: 12,
        padding: 24,
        alignItems: "center",
        background: panelBg,
      }),
    );

    // Logo
    const logo = new UIImage({ texture: Logo, width: 180, height: 58 });
    menu._node.addElement(logo);

    menu.text("UI Demo", textStyle("title", { fontSize: 28 }));
    menu.text("Builder API", textStyle("subtitle"));

    menu.button("Start Game", {
      width: 200,
      height: 40,
      textStyle: textStyle("button"),
      onClick: () => console.log("Start clicked!"),
      ...nineSliceBtn,
    });

    menu.button("Continue", {
      width: 200,
      height: 40,
      textStyle: textStyle("button"),
      onClick: () => {
        savesPanel.visible = !savesPanel.visible;
      },
      ...nineSliceBtn,
    });

    // Nested panel for save slots (toggled by Continue)
    const savesPanel = menu.panel({
      direction: "column",
      gap: 6,
      visible: false,
    });
    for (let i = 1; i <= 3; i++) {
      savesPanel.button(`Save ${i}`, {
        width: 180,
        height: 32,
        textStyle: textStyle("buttonSmall"),
        onClick: () => console.log(`Load save ${i}`),
        ...nineSliceBtn,
      });
    }

    menu.button("Settings", {
      width: 200,
      height: 40,
      textStyle: textStyle("button"),
      onClick: () => {
        settingsPanel.visible = !settingsPanel.visible;
      },
      ...nineSliceBtn,
    });

    // Settings sub-panel with checkboxes
    const settingsPanel = menu.panel({
      direction: "column",
      gap: 8,
      padding: 8,
      visible: false,
    });
    const cbSound = new UICheckbox({
      label: "Sound",
      labelStyle: textStyle("body") as Record<string, unknown>,
      checked: true,
      onChange: (v: boolean) => console.log("Sound:", v),
    });
    settingsPanel.addElement(cbSound);

    const cbFullscreen = new UICheckbox({
      label: "Fullscreen",
      labelStyle: textStyle("body") as Record<string, unknown>,
      checked: false,
      onChange: (v: boolean) => console.log("Fullscreen:", v),
    });
    settingsPanel.addElement(cbFullscreen);

    menu.button("Exit", {
      width: 200,
      height: 40,
      textStyle: textStyle("button"),
      onClick: () => console.log("Exit clicked!"),
      ...nineSliceBtn,
    });

    // ---- HUD panel in top-left ----
    const hudEntity = this.spawn("hud");
    const hud = hudEntity.add(
      new UIPanel({
        anchor: Anchor.TopLeft,
        offset: { x: 16, y: 16 },
        direction: "column",
        gap: 6,
        padding: 20,
        background: panelBg,
      }),
    );

    // HP
    hud.text("HP", textStyle("body", { fill: 0x22c55e }));
    const hpBar = new UIProgressBar({
      value: 0.8,
      width: 150,
      height: 12,
      fillBackground: { color: 0x22c55e, alpha: 1 },
    });
    hud._node.addElement(hpBar);

    // XP
    hud.text("XP", textStyle("body", { fill: 0x3b82f6 }));
    const xpBar = new UIProgressBar({
      value: 0.35,
      width: 150,
      height: 12,
      fillBackground: { color: 0x3b82f6, alpha: 1 },
    });
    hud._node.addElement(xpBar);

    hud.text("Score: 0", textStyle("body", { fontSize: 16, fill: 0xfacc15 }));

    // Damage / Heal buttons
    let hp = 0.8;
    const hudBtns = hud._node.panel({ direction: "row", gap: 6 });
    hudBtns.button("Take Damage", {
      width: 110,
      height: 28,
      background: { color: 0x661111, alpha: 1, radius: 4 },
      hoverBackground: { color: 0x882222, alpha: 1, radius: 4 },
      textStyle: textStyle("caption"),
      onClick: () => {
        hp = Math.max(0, hp - 0.15);
        hpBar.update({ value: hp });
      },
    });
    hudBtns.button("Heal", {
      width: 60,
      height: 28,
      background: { color: 0x115511, alpha: 1, radius: 4 },
      hoverBackground: { color: 0x228822, alpha: 1, radius: 4 },
      textStyle: textStyle("caption"),
      onClick: () => {
        hp = Math.min(1, hp + 0.15);
        hpBar.update({ value: hp });
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: 800,
      height: 600,
      virtualWidth: 800,
      virtualHeight: 600,
      backgroundColor: 0x0a0a0a,
      container: getContainer(),
      pixi: { resolution: window.devicePixelRatio, autoDensity: true },
    }),
  );

  engine.use(new UIPlugin());

  await loadFonts();
  await engine.start();
  engine.scenes.push(new UIExampleScene());
}

main().catch(console.error);
