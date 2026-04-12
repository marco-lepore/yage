# @yagejs/input

Keyboard, mouse, gamepad, and touch handling for the [YAGE](https://yage.dev) 2D game engine.

## Install

```bash
npm install @yagejs/input
```

## Usage

```ts
import { Engine } from "@yagejs/core";
import { InputPlugin, InputManagerKey } from "@yagejs/input";

const engine = new Engine();
engine.use(new InputPlugin({
  actions: {
    jump: ["Space", "KeyW"],
    left: ["ArrowLeft", "KeyA"],
    right: ["ArrowRight", "KeyD"],
  },
}));
```

Read input inside a component:

```ts
class PlayerController extends Component {
  private readonly input = this.service(InputManagerKey);

  update(dt: number): void {
    if (this.input.isActionDown("jump")) {
      // jump
    }
  }
}
```

## What's in the box

- **InputPlugin / InputManager** - unified keyboard, mouse, gamepad, touch
- **Action maps** - bind named actions to multiple keys
- **Runtime rebinding** - with conflict policies
- **Pointer events** - world-space mouse/touch with camera awareness

## Docs

Full documentation at [yage.dev](https://yage.dev).

## License

MIT
