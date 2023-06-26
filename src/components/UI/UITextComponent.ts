import { Container, DisplayObject, Text, TextStyle, Transform } from "pixi.js";
import { GameObject } from "../../GameObject";
import { GraphicComponent } from "../GraphicComponent";

export class UITextComponent<
  Parent extends GameObject = GameObject
> extends GraphicComponent<Parent> {
  name = "UITextComponent";
  textElement: Text;
  transform: Transform;
  constructor(
    parent: Parent,
    {
      text,
      style,
      x = 0,
      y = 0,
      renderLayer,
      linkedTransform,
    }: {
      text: string;
      style: TextStyle;
      x?: number;
      y?: number;
      renderLayer?: Container;
      linkedTransform?: Transform;
    }
  ) {
    const textElement = new Text(text, style);
    textElement.anchor.set(0.5);
    const transform = new Transform();
    transform.position.set(x, y);
    super(parent, {
      graphic: textElement,
      renderLayer,
      linkedTransform: linkedTransform ?? transform,
    });
    this.transform = transform;
    this.textElement = textElement;
  }

  setText(text: string) {
    this.textElement.text = text;
  }

  setStyle(style: TextStyle) {
    this.textElement.style = style;
  }

  setPosition(x = 0, y = 0) {
    this.transform.position.set(x, y);
  }
}
