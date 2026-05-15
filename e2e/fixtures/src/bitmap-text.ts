import { Engine, Scene, Component, Transform, Vec2 } from "@yagejs/core";
import { RendererPlugin, TextComponent } from "@yagejs/renderer";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();

const WIDTH = 480;
const HEIGHT = 270;
const SCALE = 4;
const container = setupContainer(WIDTH, HEIGHT);

/**
 * Captures the "glyph atlas signature" of the rendered text into
 * Inspector-readable fields: which Pixi class was actually constructed
 * (canvas `Text` vs `BitmapText`), the laid-out glyph extents, and the
 * world scale it's drawn at. A canvas `Text` upscaled 4× would be blurry;
 * the point of `bitmap: true` is that `BitmapText` draws crisp atlas quads.
 */
class BitmapTextProbe extends Component {
  pixiClass = "";
  glyphWidth = 0;
  glyphHeight = 0;
  worldScaleX = 0;
  captured = false;

  constructor(private readonly target: TextComponent) {
    super();
  }

  update(): void {
    if (this.captured) return;
    const t = this.target.text;
    this.pixiClass = t.constructor.name;
    // Reading width/height forces Pixi to lay glyphs out from the atlas.
    this.glyphWidth = Math.round(t.width);
    this.glyphHeight = Math.round(t.height);
    this.worldScaleX = this.entity.get(Transform).worldScale.x;
    this.captured = true;
  }

  serialize(): {
    pixiClass: string;
    glyphWidth: number;
    glyphHeight: number;
    worldScaleX: number;
    captured: boolean;
  } {
    return {
      pixiClass: this.pixiClass,
      glyphWidth: this.glyphWidth,
      glyphHeight: this.glyphHeight,
      worldScaleX: this.worldScaleX,
      captured: this.captured,
    };
  }
}

class BitmapTextScene extends Scene {
  readonly name = "bitmap-text-scene";

  onEnter(): void {
    const entity = this.spawn("bitmap-label");
    entity.add(
      new Transform({
        position: new Vec2(WIDTH / 2, HEIGHT / 2),
        scale: new Vec2(SCALE, SCALE),
      }),
    );
    const text = entity.add(
      new TextComponent({
        text: "YAGE",
        bitmap: true,
        anchor: { x: 0.5, y: 0.5 },
        style: {
          fontFamily: "monospace",
          fontSize: 12,
          fill: 0xffffff,
        },
      }),
    );
    entity.add(new BitmapTextProbe(text));
  }
}

const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0a0a0a,
    resolution: 1,
    container,
  }),
);
engine.use(new DebugPlugin());
await engine.start();
engine.inspector.time.freeze();
await engine.scenes.push(new BitmapTextScene());
