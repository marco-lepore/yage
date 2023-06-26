import {
  Container,
  DisplayObject,
  FederatedPointerEvent,
  Text,
  TextStyle,
  Transform,
} from "pixi.js";
import { GameObject } from "../../GameObject";
import { GraphicComponent } from "../GraphicComponent";
import { FancyButton } from "@pixi/ui";

export class UIButtonComponent<
  Parent extends GameObject = GameObject
> extends GraphicComponent<Parent> {
  name = "UIButtonComponent";
  element: FancyButton;
  transform: Transform;
  constructor(
    parent: Parent,
    options: ConstructorParameters<typeof FancyButton>[0],
    linkedTransform?: Transform, 
    renderLayer?: Container
  ) {
    const element = new FancyButton(options);
    const transform = new Transform();

    super(parent, {
      graphic: element,
      renderLayer,
      linkedTransform: linkedTransform ?? transform,
    });
    this.transform = transform;
    this.element = element;
  }

  setText(text: string) {
    this.element.text = text;
  }

  setPosition(x = 0, y = 0) {
    this.transform.position.set(x, y);
  }

  onPress = (
    callback: (btn: FancyButton, ev: FederatedPointerEvent) => void
  ) => {
    this.element.onPress.connect(callback);
  };

  destroy(): void {
    this.element.onPress.disconnectAll();
    this.element.destroy();
    super.destroy();
  }
}
