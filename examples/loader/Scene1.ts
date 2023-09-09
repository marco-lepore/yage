import { Vector2 } from '@dimforge/rapier2d'
import {
  GameObject,
  GraphicComponent,
  Scene,
  UITextComponent,
  getGame,
  getPlayAreaBounds,
} from '../../src'
import { Graphics, TextStyle } from 'pixi.js'
import { Scene2 } from './Scene2'
import { Loader } from './Loader'

class Text extends GameObject<Scene1> {
  constructor(parent: Scene1, x: number, y: number, w: number, h: number) {
    super(parent)

    const graphic = new Graphics()
    graphic.beginFill(0xFF0000)
    graphic.drawRect(x - w / 2, y - h / 2, w, h)
    graphic.endFill()
    const bg = this.addComponent(GraphicComponent, {
      graphic,
    })

    bg.graphic.eventMode = 'static'

    bg.graphic.addEventListener('pointertap', this.scene.changeScene)

    this.addComponent(UITextComponent, {
      text: 'Level1',
      style: new TextStyle(),
      x,
      y,
    })
  }
}

export class Scene1 extends Scene {
  assetsBundleId = 'scene1'
  assetsBundle = {
    bgm1: '/assets/examples/loader/bgm1.mp3',
    bgm2: '/assets/examples/loader/bgm2.mp3',
    img1: '/assets/examples/loader/img1.png',
    img2: '/assets/examples/loader/img2.png',
  }
  onLoad() {
    super.onLoad()
    this.rapier.pixelToMeterRatio = 10
    this.rapier.world.gravity = new Vector2(0, 0)
    const { width, height } = getPlayAreaBounds()
    this.instantiateGameObject(
      Text,
      width / 2,
      height / 2,
      width * 0.5,
      height * 0.5,
    )
  }

  changeScene = () => {
    const next = new Scene2({})
    const loader = new Loader({ next })
    getGame().transitionTo(loader)
  }
}
