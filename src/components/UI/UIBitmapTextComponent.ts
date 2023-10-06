import {
  Container,
  BitmapText,
  Transform,
  ITextStyle,
  BitmapFont,
} from 'pixi.js'
import { GameObject } from '../../GameObject'
import { GraphicComponent } from '../GraphicComponent'

export class UIBitmapTextComponent<
  Parent extends GameObject = GameObject,
> extends GraphicComponent<Parent, BitmapText> {
  name = 'UIBitmapTextComponent'
  textElement: BitmapText
  transform: Transform
  fontName: string
  style: ITextStyle
  constructor(
    parent: Parent,
    {
      text,
      style,
      x = 0,
      y = 0,
      fontName,
      renderLayer,
      linkedTransform,
    }: {
      text: string
      style: ITextStyle
      fontName?: string
      x?: number
      y?: number
      renderLayer?: Container
      linkedTransform?: Transform
    },
  ) {
    const font =
      BitmapFont.available[fontName] ??
      BitmapFont.from(fontName, style, {
        chars: BitmapFont.ASCII,
      })

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    font.lineHeight = style.lineHeight ?? font.lineHeight

    const textElement = new BitmapText(text, {
      fontName: fontName ?? Math.random().toString(),
      maxWidth: style.wordWrapWidth,
    })

    const transform = new Transform()
    transform.position.set(x, y)
    super(parent, {
      graphic: textElement,
      renderLayer,
      linkedTransform: linkedTransform ?? transform,
    })
    this.fontName = fontName
    this.transform = transform
    this.textElement = textElement
  }

  setText(text: string) {
    this.textElement.text = text
    this.textElement.dirty = true
  }

  setPosition(x = 0, y = 0) {
    this.transform.position.set(x, y)
  }
}
