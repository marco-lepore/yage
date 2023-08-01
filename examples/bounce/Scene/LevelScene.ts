import { ColliderDesc, RigidBodyDesc, Vector2 } from '@dimforge/rapier2d'
import {
  GameObject,
  GraphicComponent,
  RapierBodyComponent,
  Scene,
  getPlayAreaBounds,
  pu,
} from '../../../src'
import { Graphics } from 'pixi.js'

class Ball extends GameObject {
  constructor(parent: Scene<any, any>, x: number, y: number) {
    super(parent)
    const [px, py] = pu(x, y)
    const rigidBody = RigidBodyDesc.dynamic().setTranslation(px, py)
    const collider = ColliderDesc.ball(2).setRestitution(1)
    const phys = this.addComponent(RapierBodyComponent, rigidBody, collider)

    const graphic = new Graphics()
    graphic.beginFill(0xffffff)
    graphic.drawCircle(0, 0, 20)
    graphic.endFill()
    this.addComponent(GraphicComponent, {
      graphic,
      linkedTransform: phys.transform,
    })

    phys.rigidBody.applyImpulse(new Vector2(200, 2), true)
  }
}

class Wall extends GameObject {
  constructor(
    parent: Scene<any, any>,
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
    graphic.beginFill(0xffffff)
    graphic.drawRect(x - w / 2, y - h / 2, w, h)
    graphic.endFill()
    this.addComponent(GraphicComponent, {
      graphic,
      linkedTransform: phys.transform,
    })
  }
}

export class LevelScene extends Scene<any, any> {
  onLoad() {
    super.onLoad()
    this.rapier.pixelToMeterRatio = 10
    this.rapier.world.gravity = new Vector2(0, 0)
    const { width, height } = getPlayAreaBounds()
    const ball = this.instantiateGameObject(Ball, width / 2, height / 2)

    this.instantiateGameObject(Wall, 0, height / 2, 30, height)
    this.instantiateGameObject(Wall, width, height / 2, 30, height)
    this.instantiateGameObject(Wall, width / 2, 0, width, 30)
    this.instantiateGameObject(Wall, width / 2, height, width, 30)
  }
}
