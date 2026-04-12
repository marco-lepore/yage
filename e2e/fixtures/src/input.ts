import {
  Engine,
  Component,
  Scene,
  Transform,
} from "@yage/core";
import { RendererPlugin } from "@yage/renderer";
import { InputPlugin, InputManagerKey } from "@yage/input";
import { DebugPlugin } from "@yage/debug";
import { injectStyles } from "./shared.js";

injectStyles();

class InputProbe extends Component {
  private readonly input = this.service(InputManagerKey);

  jumpPressed = false;
  jumpJustPressed = false;
  jumpJustReleased = false;

  update(): void {
    this.jumpPressed = this.input.isPressed("jump");
    this.jumpJustPressed = this.input.isJustPressed("jump");
    this.jumpJustReleased = this.input.isJustReleased("jump");
  }
}

class InputScene extends Scene {
  readonly name = "input-scene";

  onEnter(): void {
    const entity = this.spawn("input-display");
    entity.add(new Transform());
    entity.add(new InputProbe());
  }
}

const engine = new Engine({ debug: true });
engine.use(new RendererPlugin({ width: 320, height: 180, backgroundColor: 0x0a0a0a, resolution: 1, container: document.getElementById("game-container") ?? document.body }));
engine.use(new InputPlugin({
  actions: {
    jump: ["Space"],
  },
}));
engine.use(new DebugPlugin({ manualClock: true }));
await engine.start();
await engine.scenes.push(new InputScene());
