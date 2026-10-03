import { Component, Engine, InspectorKey, Scene } from "@yagejs/core";
import { RendererKey, RendererPlugin } from "@yagejs/renderer";
import { DebugPlugin } from "@yagejs/debug";
import { InputPlugin } from "@yagejs/input";
import { Anchor, UIPlugin, UISurface } from "@yagejs/ui";
import { LightingComposite } from "@yagejs/lighting";
import { Container, Graphics } from "pixi.js";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();
const engine = new Engine({ debug: true });
const renderer = new RendererPlugin({
  width: 320,
  height: 180,
  resolution: 1,
  container: setupContainer(320, 180),
});
engine.use(renderer);
engine.use(
  new InputPlugin({
    actions: {
      "move-up": ["ArrowUp"],
      "move-down": ["ArrowDown"],
      "move-left": ["ArrowLeft"],
      "move-right": ["ArrowRight"],
      interact: ["Enter"],
      cancel: ["Escape"],
    },
  }),
);
engine.use(new UIPlugin());
engine.use(new DebugPlugin({ startFrozen: true }));

class DrawingProbe extends Component {
  ticks = 0;
  clicks = 0;
  color = 0xffffff;
  surface!: UISurface;
  readonly source = new Graphics();
  readonly parent = new Container();
  readonly graphicsParent = new Container({ isRenderGroup: true });
  readonly graphic = new Graphics().rect(0, 0, 20, 20).fill(0xff0000);
  private composite!: LightingComposite;

  onAdd(): void {
    const owner = this.use(RendererKey);
    owner.application.stage.addChild(this.parent);
    owner.application.stage.addChild(this.graphicsParent);
    this.graphicsParent.addChild(this.graphic);
    this.source.label = "drawing-test-light";
    this.composite = new LightingComposite(owner, {
      source: this.source,
      parent: this.parent,
      width: 320,
      height: 180,
      bounce: { radius: 8, strength: 0.2 },
    });
    this.surface = this.entity.add(
      new UISurface({
        anchor: Anchor.TopLeft,
        offset: { x: 10, y: 10 },
        width: 100,
        height: 40,
        focus: { wrap: true },
      }),
    );
    this.surface.button("Press", {
      width: 100,
      height: 40,
      onClick: () => {
        this.clicks++;
      },
    });
  }

  update(): void {
    this.ticks++;
    this.color = this.ticks % 2 === 0 ? 0xff0000 : 0x00ff00;
    this.source.clear().rect(0, 0, 320, 180).fill(this.color);
    this.composite.invalidate();
    this.composite.render();
  }

  onDestroy(): void {
    this.composite.destroy();
    this.parent.destroy();
    this.source.destroy();
    this.graphicsParent.destroy({ children: true });
  }

  redrawGraphic(): void {
    this.graphic.clear().rect(0, 0, 50, 50).fill(0x00ff00);
    this.graphic.x = 150;
    this.graphic.y = 100;
  }

  requestHiddenLight(): void {
    this.source.visible = false;
    this.composite.invalidate();
    this.composite.render();
  }
}
class DrawingScene extends Scene {
  readonly name = "drawing-scene";
  probe!: DrawingProbe;
  onEnter(): void {
    this.probe = this.spawn("probe").add(new DrawingProbe());
  }
}
await engine.start();
let scene = new DrawingScene();
await engine.scenes.push(scene);
const inspector = engine.context.resolve(InspectorKey);
inspector.time.step();
let canvasDraws = 0;
let lightDraws = 0;
let bounceDraws = 0;
let lightColor = 0;
const pixi = renderer.application.renderer;
const draw = pixi.render.bind(pixi);
pixi.render = (options) => {
  const object = options instanceof Container ? options : options.container;
  if (object === renderer.application.stage) canvasDraws++;
  if (object.label === "drawing-test-light") {
    lightDraws++;
    lightColor = scene.probe.color;
  }
  if (object.label === "lighting:bounce-source") bounceDraws++;
  return draw(options);
};
inspector.addExtension("drawing-test", {
  redrawGraphic: () => scene.probe.redrawGraphic(),
  graphicPixel: () =>
    Array.from(
      renderer.captureCanvas().getContext("2d")!.getImageData(160, 110, 1, 1)
        .data,
    ),
  requestHiddenLight: () => scene.probe.requestHiddenLight(),
  showLight: () => {
    scene.probe.source.visible = true;
  },
  setDrawing: (enabled: boolean) => {
    renderer.drawingEnabled = enabled;
  },
  reset: () => {
    canvasDraws = 0;
    lightDraws = 0;
    bounceDraws = 0;
  },
  move: (x: number) => scene.probe.surface.setOffset(x, 10),
  replace: async () => {
    scene = new DrawingScene();
    await engine.scenes.replace(scene);
  },
  read: () => ({
    canvasDraws,
    lightDraws,
    bounceDraws,
    lightColor,
    color: scene.probe.color,
    ticks: scene.probe.ticks,
    clicks: scene.probe.clicks,
    focus: scene.probe.surface.focusScope?.hasInput,
    drawing: renderer.drawingEnabled,
    visible: renderer.application.stage.visible,
  }),
});
