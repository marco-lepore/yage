import {
  Component,
  InputManagerKey,
  Scene,
  Transform,
  createGame,
} from "yage";
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

await createGame({
  width: 320,
  height: 180,
  backgroundColor: 0x0a0a0a,
  renderer: { resolution: 1 },
  input: {
    actions: {
      jump: ["Space"],
    },
  },
  debug: { manualClock: true },
  scene: new InputScene(),
});
