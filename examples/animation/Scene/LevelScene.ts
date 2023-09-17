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
} from '../../../src'
import { Graphics } from 'pixi.js'

const keyframes1 = [
  {
    time: 0,
    data: 1,
    easing: 'easeOut',
    event() {
      console.log('animation 1 start')
    },
  },
  {
    time: 3000,
    data: 1.5,
    easing: 'easeIn',
    event() {
      console.log('animation 1 50%')
    },
  },
  {
    time: 6000,
    data: 1,
    event() {
      console.log('animation 1 end')
    },
  },
] satisfies Keyframe<number>[]

const keyframes2 = [
  {
    time: 0,
    data: 1,
    easing: 'linear',
  },
  {
    time: 3000,
    data: 1.5,
    easing: 'linear',
  },
  {
    time: 6000,
    data: 1,
  },
] satisfies Keyframe<number>[]

class Ball extends GameObject {
  constructor(
    parent: AnimationScene,
    x: number,
    y: number,
    keyframes: Keyframe<number>[],
  ) {
    super(parent)
    const [px, py] = pu(x, y)
    const rigidBody = RigidBodyDesc.dynamic().setTranslation(px, py)
    const collider = ColliderDesc.ball(2).setRestitution(1)
    const phys = this.addComponent(RapierBodyComponent, rigidBody, collider)

    const graphic = new Graphics()
    graphic.beginFill(0xFFFFFF)
    graphic.drawCircle(0, 0, 20)
    graphic.endFill()
    this.addComponent(GraphicComponent, {
      graphic,
      linkedTransform: phys.transform,
    })
    const animations = this.createAnimations(graphic, keyframes)
    const animationController = this.addComponent(
      AnimationControllerComponent,
      animations,
    )

    animationController.play('idle')
  }

  createAnimations(graphic: Graphics, keyframes: Keyframe<number>[]) {
    const predicate = (data: number) => {
      graphic.scale.set(data)
    }
    const idle: Animation<number> = {
      predicate,
      runOnFixedUpdate: true,
      speed: 1,
      loop: true,
      keyframes,
      onEnter() {
        console.log('onEnter')
      },
      onExit(complete) {
        console.log('onExit', complete)
      },
    }
    return { idle }
  }
}

class Wall extends GameObject {
  constructor(
    parent: AnimationScene,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    super(parent)
    const [px, py, pw, ph] = pu(x, y, w, h)
    const rigidBody = RigidBodyDesc.fixed()
    const collider = ColliderDesc.cuboid(pw / 2, ph / 2)
      .setTranslation(px, py)
      .setRestitution(1)
    const phys = this.addComponent(RapierBodyComponent, rigidBody, collider)

    const graphic = new Graphics()
    graphic.beginFill(0xFFFFFF)
    graphic.drawRect(x - w / 2, y - h / 2, w, h)
    graphic.endFill()
    this.addComponent(GraphicComponent, {
      graphic,
      linkedTransform: phys.transform,
    })
  }
}

export class AnimationScene extends Scene<void> {
  onLoad() {
    super.onLoad()
    this.rapier.pixelToMeterRatio = 10
    this.rapier.world.gravity = new Vector2(0, 0)
    const { width, height } = getPlayAreaBounds()
    this.instantiateGameObject(Ball, width * 0.25, height / 2, keyframes1)
    this.instantiateGameObject(Ball, width * 0.75, height / 2, keyframes2)

    this.instantiateGameObject(Wall, 0, height / 2, 30, height)
    this.instantiateGameObject(Wall, width, height / 2, 30, height)
    this.instantiateGameObject(Wall, width / 2, 0, width, 30)
    this.instantiateGameObject(Wall, width / 2, height, width, 30)
  }
}
