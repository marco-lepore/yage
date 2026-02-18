import { Vector2 } from '@dimforge/rapier2d'
import {
  GameObject,
  GraphicComponent,
  LoadingScene,
  Scene,
  UITextComponent,
  getGame,
  getPlayAreaBounds,
} from '../../src'
import { Graphics, TextStyle } from 'pixi.js'

class Text extends GameObject<Loader> {
  textComponent: UITextComponent
  constructor(parent: Loader, x: number, y: number) {
    super(parent)

    const text = this.addComponent(UITextComponent, {
      text: 'Loading: 0%',
      style: new TextStyle({ fill: 0xffffff }),
      x,
      y,
    })

    text.textElement.anchor.set(1, 1)

    this.textComponent = text
  }

  setText(s: string) {
    this.textComponent.setText(s)
  }
}

export class Loader extends LoadingScene {
  loadingText: Text
  onLoad() {
    super.onLoad()

    const { width, height } = getPlayAreaBounds()
    this.loadingText = this.instantiateGameObject(
      Text,
      width * 0.95,
      height * 0.95,
    )
  }

  onProgress = (n: number): void => {
    this.loadingText.setText('Loading: ' + (n * 100).toFixed(0) + '%')
  }
}
