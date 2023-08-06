import { ColliderDesc, RigidBodyDesc, Vector2 } from '@dimforge/rapier2d'
import {
  AnimationControllerComponent,
  GameObject,
  GraphicComponent,
  RapierBodyComponent,
  Scene,
  getPlayAreaBounds,
  pu,
  Animation,
  Keyframe,
  InputComponent,
  UITextComponent,
  Process,
} from '../../../src'
import { Graphics, TextStyle } from 'pixi.js'

class BaseText extends UITextComponent {
  constructor(parent: TextManager, text: string, x: number, y: number) {
    super(parent, { text, x, y, style: new TextStyle({ fill: 0xffffff }) })
    console.log(text, x, y)
    console.log(this.textElement)
  }
}

class RisingText extends BaseText {
  constructor(parent: TextManager, text: string, x: number, y: number) {
    super(parent, text, x, y)

    Process.spawn({
      duration: 2000,
      onTick: ({ elapsed, totalElapsed }) => {
        this.setPosition(x, y - (totalElapsed / 2000) * 100)
      },
      onComplete: () => {
        this.parent.unregisterComponent(this)
      },
    })
  }
}

class TextManager extends GameObject {
  input: InputComponent
  center: [number, number]
  constructor(parent: Scene<any, any>, x: number, y: number) {
    super(parent)
    this.center = [x, y]
    this.input = this.addComponent(
      InputComponent,
      new Map<string, string[]>([['fire', ['Space', 'KeyA']]]),
    )
  }

  holdText?: BaseText

  onFixedTick(elapsedMS: number): void {
    super.onFixedTick(elapsedMS)
    if (this.input.isJustPressed('fire')) {
      this.addComponent(RisingText, 'Just Pressed', ...this.center)
    } else if (this.input.isHoldingFor('fire', 1000)) {
      const holdTime = this.input.getHoldingTime('fire')
      if (!this.holdText) {
        this.holdText = this.addComponent(
          BaseText,
          'Holding ' + holdTime?.toFixed(0),
          ...this.center,
        )
      } else {
        this.holdText.setText('Holding' + holdTime?.toFixed(0))
      }
    } else if (this.input.isJustReleased('fire')) {
      this.addComponent(RisingText, 'Just Released', ...this.center)
      if (this.holdText) {
        this.unregisterComponent(this.holdText)
        this.holdText = undefined
      }
    }
  }
}

export class LevelScene extends Scene<any, any> {
  onLoad() {
    super.onLoad()
    this.rapier.pixelToMeterRatio = 10
    this.rapier.world.gravity = new Vector2(0, 0)
    const { width, height } = getPlayAreaBounds()
    this.instantiateGameObject(TextManager, width * 0.5, height * 0.5)
  }
}
