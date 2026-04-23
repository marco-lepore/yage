import {
  Engine,
  Component,
  Scene,
  Transform,
} from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();
const container = setupContainer(320, 180);

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
engine.use(new RendererPlugin({ width: 320, height: 180, backgroundColor: 0x0a0a0a, resolution: 1, container }));
engine.use(new InputPlugin({
  actions: {
    jump: ["Space"],
  },
}));
engine.use(new DebugPlugin({ manualClock: true }));
await engine.start();
await engine.scenes.push(new InputScene());
