import { Engine, Scene, Transform, Vec2, Component } from "@yagejs/core";
import { RendererPlugin, GraphicsComponent } from "@yagejs/renderer";
import type { LayerDef } from "@yagejs/renderer";
import { UIPlugin, UIPanel, Anchor } from "@yagejs/ui";
import { injectStyles, getContainer } from "./shared.js";
import { textStyle, loadFonts, allAssets, nineSliceBtn, panelBg } from "./ui-theme.js";

injectStyles();

const WIDTH = 800;
const HEIGHT = 600;

// ---------------------------------------------------------------------------
// Spinning background shapes (so we can see UI layers float above the world)
// ---------------------------------------------------------------------------
class Spinner extends Component {
  private readonly speed = 0.3 + Math.random() * 0.7;
  update(dt: number): void {
    const t = this.entity.get(Transform);
    t.rotation += this.speed * (dt / 1000);
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class UILayersScene extends Scene {
  readonly name = "ui-layers";
  readonly preload = [...allAssets];
  readonly layers: readonly LayerDef[] = [
    { name: "hud", order: 1010, space: "screen" },
    { name: "menu", order: 1020, space: "screen" },
    { name: "dialog", order: 1030, space: "screen" },
  ];

  onEnter(): void {
    // Background shapes
    const shapes = [0x1e3a5f, 0x3b1f5c, 0x1f3b2f, 0x5c3b1f];
    for (let i = 0; i < shapes.length; i++) {
      const e = this.spawn(`bg-${i}`);
      const x = 150 + i * 170;
      e.add(new Transform({ position: new Vec2(x, HEIGHT / 2) }));
      e.add(
        new GraphicsComponent().draw((g) => {
          g.rect(-40, -40, 80, 80).fill({ color: shapes[i]!, alpha: 0.5 });
          g.rect(-40, -40, 80, 80).stroke({ color: 0x555555, width: 1 });
        }),
      );
      e.add(new Spinner());
    }

    // ---- HUD layer (always visible) ----
    let menuVisible = false;
    let dialogVisible = false;

    const hudEntity = this.spawn("hud-panel");
    const hud = hudEntity.add(
      new UIPanel({
        layer: "hud",
        anchor: Anchor.TopLeft,
        offset: { x: 16, y: 16 },
        direction: "column",
        gap: 8,
        padding: 16,
        background: panelBg,
      }),
    );
    hud.text("UI Layers Demo", textStyle("title", { fontSize: 16 }));
    hud.text("HUD layer (order 10)", textStyle("caption"));
    hud.text("Score: 1,234", textStyle("body", { fill: 0xfacc15 }));

    hud.button("Toggle Menu (order 20)", {
      width: 260, height: 44,
      textStyle: textStyle("button"),
      onClick: () => {
        menuVisible = !menuVisible;
        menuPanel.visible = menuVisible;
      },
      ...nineSliceBtn,
    });

    hud.button("Toggle Dialog (order 30)", {
      width: 260, height: 44,
      textStyle: textStyle("button"),
      onClick: () => {
        dialogVisible = !dialogVisible;
        dialogPanel.visible = dialogVisible;
      },
      ...nineSliceBtn,
    });

    // ---- Menu layer ----
    const menuEntity = this.spawn("menu-panel");
    const menuPanel = menuEntity.add(
      new UIPanel({
        layer: "menu",
        anchor: Anchor.Center,
        direction: "column",
        gap: 10,
        padding: 24,
        alignItems: "center",
        background: panelBg,
        visible: false,
      }),
    );
    menuPanel.text("Menu Panel", textStyle("title", { fontSize: 20 }));
    menuPanel.text("Layer: menu (order 20)", textStyle("caption"));
    menuPanel.text("Renders above HUD, below Dialog", textStyle("body"));

    menuPanel.button("Settings", {
      width: 220, height: 44,
      textStyle: textStyle("button"),
      onClick: () => console.log("Settings clicked"),
      ...nineSliceBtn,
    });
    menuPanel.button("Inventory", {
      width: 220, height: 44,
      textStyle: textStyle("button"),
      onClick: () => console.log("Inventory clicked"),
      ...nineSliceBtn,
    });
    menuPanel.button("Close Menu", {
      width: 220, height: 44,
      textStyle: textStyle("button"),
      onClick: () => {
        menuVisible = false;
        menuPanel.visible = false;
      },
      ...nineSliceBtn,
    });

    // ---- Dialog layer (highest z-order) ----
    const dialogEntity = this.spawn("dialog-panel");
    const dialogPanel = dialogEntity.add(
      new UIPanel({
        layer: "dialog",
        anchor: Anchor.Center,
        offset: { x: 0, y: -40 },
        direction: "column",
        gap: 10,
        padding: 24,
        alignItems: "center",
        background: panelBg,
        visible: false,
      }),
    );
    dialogPanel.text("Confirm Action", textStyle("title", { fontSize: 18 }));
    dialogPanel.text("Layer: dialog (order 30)", textStyle("caption"));
    dialogPanel.text("Are you sure?", textStyle("body"));

    const btnRow = dialogPanel.panel({ direction: "row", gap: 10 });
    btnRow.button("Yes", {
      width: 110, height: 44,
      textStyle: textStyle("button"),
      onClick: () => {
        dialogVisible = false;
        dialogPanel.visible = false;
        console.log("Confirmed!");
      },
      ...nineSliceBtn,
    });
    btnRow.button("No", {
      width: 110, height: 44,
      textStyle: textStyle("button"),
      onClick: () => {
        dialogVisible = false;
        dialogPanel.visible = false;
      },
      ...nineSliceBtn,
    });
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const engine = new Engine({ debug: true });

  engine.use(new RendererPlugin({
    width: WIDTH, height: HEIGHT,
    virtualWidth: WIDTH, virtualHeight: HEIGHT,
    backgroundColor: 0x0a0a0a,
    container: getContainer(),
  }));
  engine.use(new UIPlugin());

  await loadFonts();
  await engine.start();
  await engine.scenes.push(new UILayersScene());
}

main().catch(console.error);
